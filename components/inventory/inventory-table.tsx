"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { MoreHorizontal, QrCode, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { InventoryRow } from "@/lib/factory-registry";
import type { RegistryStatus } from "@/lib/provisioning";
import {
  addSerialAction, allocateSerialsAction, deallocateSerialsAction,
  importRegistryCsvAction, setRegistryStatusAction,
} from "@/lib/actions/inventory";

// Filters are debounced on the client but always resolved server-side —
// keeps a 10k-row registry off the wire and lets Postgres do the `ilike`.
const BATCH_FILTER_DEBOUNCE_MS = 300;

const STATUS_VARIANT: Record<InventoryRow["status"], "default" | "secondary" | "outline" | "destructive"> = {
  manufactured: "outline",
  allocated: "secondary",
  claimed: "default",
  rma: "destructive",
  retired: "destructive",
};

interface Customer { id: string; name: string }
interface StoreOption { id: string; name: string; organizationId: string }

export function InventoryTable({
  rows, customers, stores, page, pageCount, total, status, batch,
}: {
  rows: InventoryRow[];
  customers: Customer[];
  stores: StoreOption[];
  page: number;
  pageCount: number;
  total: number;
  status: RegistryStatus | "all";
  batch: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState<string>(status);
  const [batchFilter, setBatchFilter] = useState(batch);
  const [busy, setBusy] = useState(false);
  const batchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the controls in sync with the URL (e.g. browser back/forward).
  useEffect(() => setStatusFilter(status), [status]);
  useEffect(() => setBatchFilter(batch), [batch]);
  useEffect(() => () => {
    if (batchDebounceRef.current) clearTimeout(batchDebounceRef.current);
  }, []);

  function navigate(next: { status?: string; batch?: string; page?: number }) {
    const params = new URLSearchParams();
    const nextStatus = next.status ?? statusFilter;
    const nextBatch = next.batch ?? batchFilter;
    const nextPage = next.page ?? 1;
    if (nextStatus !== "all") params.set("status", nextStatus);
    if (nextBatch) params.set("batch", nextBatch);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    router.replace(qs ? `/admin/inventory?${qs}` : "/admin/inventory");
  }

  function onStatusFilterChange(value: string) {
    setStatusFilter(value);
    navigate({ status: value, page: 1 });
  }

  function onBatchFilterChange(value: string) {
    setBatchFilter(value);
    if (batchDebounceRef.current) clearTimeout(batchDebounceRef.current);
    batchDebounceRef.current = setTimeout(() => {
      navigate({ batch: value, page: 1 });
    }, BATCH_FILTER_DEBOUNCE_MS);
  }

  function goToPage(p: number) {
    navigate({ page: p });
  }

  // Single-serial add (barcode scanner) state
  const [addSerial, setAddSerial] = useState("");
  const [addBatch, setAddBatch] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const addSerialRef = useRef<HTMLInputElement>(null);

  // Allocate dialog state
  const [allocating, setAllocating] = useState<string | null>(null); // serial
  const [allocOrg, setAllocOrg] = useState<string>("");
  const [allocStore, setAllocStore] = useState<string>("none");

  // QR dialog state
  const [qrSerial, setQrSerial] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  async function onImportFile(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const result = await importRegistryCsvAction(text);
      if (result.ok) {
        toast.success(`Imported ${result.imported} serial${result.imported === 1 ? "" : "s"}.`);
        result.errors.forEach((e) => toast.warning(e));
      } else {
        result.errors.forEach((e) => toast.error(e));
      }
    } catch {
      toast.error("Import failed — try again.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onAddSerial(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!addSerial.trim()) return;
    setAddBusy(true);
    try {
      const result = await addSerialAction(addSerial.trim(), addBatch.trim() || null);
      if (result.ok) {
        toast.success("Serial added.");
        setAddSerial("");
        addSerialRef.current?.focus();
      } else {
        toast.error(result.error ?? "Failed to add serial.");
      }
    } catch {
      toast.error("Failed to add serial.");
    } finally {
      setAddBusy(false);
    }
  }

  function closeAllocateDialog() {
    setAllocating(null);
    setAllocOrg("");
    setAllocStore("none");
  }

  async function onAllocate() {
    if (!allocating || !allocOrg) return;
    setBusy(true);
    try {
      const result = await allocateSerialsAction(
        [allocating], allocOrg, allocStore === "none" ? null : allocStore,
      );
      if (result.ok) toast.success(`Allocated ${result.updated} serial.`);
      else toast.error(result.error ?? "Allocation failed.");
    } catch {
      toast.error("Allocation failed — try again.");
    } finally {
      setBusy(false);
      closeAllocateDialog();
    }
  }

  async function onShowQr(serial: string) {
    setQrSerial(serial);
    setQrDataUrl(await QRCode.toDataURL(serial, { width: 240, margin: 1 }));
  }

  const orgStores = stores.filter((s) => s.organizationId === allocOrg);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import from factory CSV</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onImportFile(e.target.files[0])}
          />
          <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Choose CSV…
          </Button>
          <span className="text-muted-foreground">
            Columns: <code>serial,batch,hw_rev,manufactured_at</code> — serial required, re-import updates in place.
          </span>
        </CardContent>
        <CardContent className="border-t pt-4">
          <form onSubmit={onAddSerial} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="add-serial-input" className="text-xs text-muted-foreground">
                Serial (scan or type)
              </label>
              <Input
                id="add-serial-input"
                ref={addSerialRef}
                placeholder="84f703aabbcc"
                value={addSerial}
                onChange={(e) => setAddSerial(e.target.value)}
                className="w-56 font-mono text-sm"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="add-batch-input" className="text-xs text-muted-foreground">
                Batch (optional)
              </label>
              <Input
                id="add-batch-input"
                placeholder="B2026-07"
                value={addBatch}
                onChange={(e) => setAddBatch(e.target.value)}
                className="w-40 text-sm"
              />
            </div>
            <Button type="submit" disabled={addBusy || !addSerial.trim()}>
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={onStatusFilterChange}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="manufactured">Manufactured</SelectItem>
            <SelectItem value="allocated">Allocated</SelectItem>
            <SelectItem value="claimed">Claimed</SelectItem>
            <SelectItem value="rma">RMA</SelectItem>
            <SelectItem value="retired">Retired</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Filter by batch…"
          value={batchFilter}
          onChange={(e) => onBatchFilterChange(e.target.value)}
          className="w-48"
        />
        <span className="text-sm text-muted-foreground">{rows.length} of {total}</span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Serial</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Store</TableHead>
            <TableHead>Device</TableHead>
            <TableHead>Manufactured</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.serial}>
              <TableCell className="font-mono text-xs">{r.serial}</TableCell>
              <TableCell>{r.batchCode ?? "—"}</TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5">
                  <Badge variant={STATUS_VARIANT[r.status]} className="capitalize">{r.status}</Badge>
                  {r.unregistered && <Badge variant="destructive">unregistered</Badge>}
                </span>
              </TableCell>
              <TableCell>
                {r.allocatedOrganizationId ? (
                  <Link href={`/admin/customers/${r.allocatedOrganizationId}`} className="underline">
                    {r.allocatedOrgName}
                  </Link>
                ) : "—"}
              </TableCell>
              <TableCell>
                {r.allocatedStoreId ? (
                  <span className="inline-flex items-center gap-1.5">
                    {r.allocatedStoreName ?? r.allocatedStoreId}
                    {r.status === "allocated" && (
                      <Badge variant="outline" className="text-[10px]">zero-touch</Badge>
                    )}
                  </span>
                ) : "—"}
              </TableCell>
              <TableCell>
                {r.deviceId ? (
                  <Link href={`/admin/devices/${r.deviceId}`} className="underline">
                    {r.deviceName ?? r.deviceId}
                  </Link>
                ) : "—"}
              </TableCell>
              <TableCell>{r.manufacturedAt ? new Date(r.manufacturedAt).toLocaleDateString() : "—"}</TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8">
                      <MoreHorizontal className="size-4" />
                      <span className="sr-only">Actions for {r.serial}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(r.status === "manufactured" || r.status === "allocated") && (
                      <DropdownMenuItem onSelect={() => { setAllocating(r.serial); setAllocOrg(r.allocatedOrganizationId ?? ""); }}>
                        Allocate to customer…
                      </DropdownMenuItem>
                    )}
                    {r.status === "allocated" && (
                      <DropdownMenuItem
                        onSelect={async () => {
                          try {
                            const res = await deallocateSerialsAction([r.serial]);
                            if (res.ok && res.updated > 0) {
                              toast.success("Allocation removed.");
                            } else {
                              toast.info("Nothing to deallocate — row already changed.");
                            }
                          } catch {
                            toast.error("Failed to remove allocation.");
                          }
                        }}
                      >
                        Remove allocation
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => onShowQr(r.serial)}>
                      <QrCode className="size-4" /> Show label QR
                    </DropdownMenuItem>
                    {r.status !== "rma" && (
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={async () => {
                          try {
                            const res = await setRegistryStatusAction(r.serial, "rma");
                            if (res.ok) toast.success("Marked as RMA.");
                            else toast.error("Failed to mark as RMA.");
                          } catch {
                            toast.error("Failed to mark as RMA.");
                          }
                        }}
                      >
                        Mark as RMA
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                No serials match. Import a factory CSV to get started.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Page {page} of {pageCount}</span>
        <span className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => goToPage(page + 1)}
          >
            Next
          </Button>
        </span>
      </div>

      <Dialog open={allocating !== null} onOpenChange={(o) => !o && closeAllocateDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allocate {allocating}</DialogTitle>
            <DialogDescription>
              Zero-touch auto-claim requires BOTH a customer and a store. Without a
              store the device stays on the normal pairing-code claim path.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={allocOrg} onValueChange={(v) => { setAllocOrg(v); setAllocStore("none"); }}>
              <SelectTrigger><SelectValue placeholder="Customer…" /></SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={allocStore} onValueChange={setAllocStore} disabled={!allocOrg}>
              <SelectTrigger><SelectValue placeholder="Store (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No store — manual claim</SelectItem>
                {orgStores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAllocateDialog}>Cancel</Button>
            <Button disabled={!allocOrg || busy} onClick={onAllocate}>Allocate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={qrSerial !== null} onOpenChange={(o) => !o && setQrSerial(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{qrSerial}</DialogTitle>
            <DialogDescription>Label QR — encodes the bare serial string.</DialogDescription>
          </DialogHeader>
          {qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt={`QR for ${qrSerial}`} className="mx-auto rounded bg-white p-2" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

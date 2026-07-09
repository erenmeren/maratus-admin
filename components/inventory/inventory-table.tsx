"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import {
  allocateSerialsAction, deallocateSerialsAction,
  importRegistryCsvAction, setRegistryStatusAction,
} from "@/lib/actions/inventory";

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
  rows, customers, stores,
}: {
  rows: InventoryRow[];
  customers: Customer[];
  stores: StoreOption[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [batchFilter, setBatchFilter] = useState("");
  const [busy, setBusy] = useState(false);

  // Allocate dialog state
  const [allocating, setAllocating] = useState<string | null>(null); // serial
  const [allocOrg, setAllocOrg] = useState<string>("");
  const [allocStore, setAllocStore] = useState<string>("none");

  // QR dialog state
  const [qrSerial, setQrSerial] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (statusFilter === "all" || r.status === statusFilter) &&
          (!batchFilter || (r.batchCode ?? "").toLowerCase().includes(batchFilter.toLowerCase())),
      ),
    [rows, statusFilter, batchFilter],
  );

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
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
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
    } finally {
      setBusy(false);
      setAllocating(null);
      setAllocOrg("");
      setAllocStore("none");
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
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
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
          onChange={(e) => setBatchFilter(e.target.value)}
          className="w-48"
        />
        <span className="text-sm text-muted-foreground">{filtered.length} of {rows.length}</span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Serial</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Device</TableHead>
            <TableHead>Manufactured</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => (
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
                          const res = await deallocateSerialsAction([r.serial]);
                          if (res.ok) toast.success("Allocation removed.");
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
                          const res = await setRegistryStatusAction(r.serial, "rma");
                          if (res.ok) toast.success("Marked as RMA.");
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
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                No serials match. Import a factory CSV to get started.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={allocating !== null} onOpenChange={(o) => !o && setAllocating(null)}>
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
            <Button variant="outline" onClick={() => setAllocating(null)}>Cancel</Button>
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

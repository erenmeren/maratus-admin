"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { offboardCustomerAction } from "@/lib/actions/offboarding";
import type { DeviceChoice, DeviceDisposition } from "@/lib/offboarding";

interface OffboardDevice {
  id: string;
  name: string;
  serial: string | null;
  status: string;
}

const DISPOSITION_LABEL: Record<DeviceDisposition, string> = {
  return_to_stock: "Return to stock",
  leave_with_customer: "Leave with customer",
};

export function OffboardWizard({
  organizationId,
  organizationName,
  devices,
}: {
  organizationId: string;
  organizationName: string;
  devices: OffboardDevice[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [dispositions, setDispositions] = React.useState<
    Record<string, DeviceDisposition>
  >(() => Object.fromEntries(devices.map((d) => [d.id, "return_to_stock"])));
  const [note, setNote] = React.useState("");
  const [confirmText, setConfirmText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  function reset() {
    setDispositions(
      Object.fromEntries(devices.map((d) => [d.id, "return_to_stock"])),
    );
    setNote("");
    setConfirmText("");
    setBusy(false);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function applyToAll(disposition: DeviceDisposition) {
    setDispositions(
      Object.fromEntries(devices.map((d) => [d.id, disposition])),
    );
  }

  async function onConfirm() {
    setBusy(true);
    const choices: DeviceChoice[] = devices.map((d) => ({
      deviceId: d.id,
      disposition: dispositions[d.id] ?? "return_to_stock",
    }));
    try {
      const res = await offboardCustomerAction(
        organizationId,
        choices,
        note.trim() || null,
      );
      if (!res.ok) {
        toast.error(res.error ?? "Failed to offboard customer.");
        return;
      }
      const s = res.summary;
      toast.success(
        s
          ? `Returned ${s.returnedToStock} to stock, left ${s.leftWithCustomer} with customer, revoked ${s.revokedKeys} keys.`
          : "Customer offboarded.",
      );
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      toast.error("Failed to offboard customer — try again.");
    } finally {
      setBusy(false);
    }
  }

  const confirmArmed = confirmText === organizationName;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="destructive">Offboard customer…</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Offboard {organizationName}</DialogTitle>
          <DialogDescription>
            Archives the customer: decides each device&apos;s fate, revokes API
            keys, cancels pending invitations, and freezes the credit balance.
            This is reversible — a platform admin can restore the customer
            later, but revoked keys and device dispositions stay undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {devices.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Devices ({devices.length})</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyToAll("return_to_stock")}
                  >
                    All → return to stock
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyToAll("leave_with_customer")}
                  >
                    All → leave with customer
                  </Button>
                </div>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-2">
                {devices.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{d.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {d.serial ?? "no serial"} · {d.status}
                      </p>
                    </div>
                    <Select
                      value={dispositions[d.id] ?? "return_to_stock"}
                      onValueChange={(v) =>
                        setDispositions((prev) => ({
                          ...prev,
                          [d.id]: v as DeviceDisposition,
                        }))
                      }
                    >
                      <SelectTrigger className="w-56 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="return_to_stock">
                          {DISPOSITION_LABEL.return_to_stock}
                        </SelectItem>
                        <SelectItem value="leave_with_customer">
                          {DISPOSITION_LABEL.leave_with_customer}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </>
          )}
          {devices.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No devices assigned — archiving will still revoke keys, cancel
              invitations, and freeze credits.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="offboard-note">Note (optional)</Label>
            <Input
              id="offboard-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. churned, moved to competitor"
            />
          </div>

          <div className="space-y-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <Label htmlFor="offboard-confirm" className="flex items-center gap-1.5">
              <TriangleAlert className="size-3.5 text-destructive" />
              Type <span className="font-mono">{organizationName}</span> to confirm
            </Label>
            <Input
              id="offboard-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={!confirmArmed || busy}
            onClick={onConfirm}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? "Archiving…" : "Offboard customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

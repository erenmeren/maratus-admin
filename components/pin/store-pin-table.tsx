"use client";

// Per-store pin management for /tenant/pinned-qr. Each store resolves its own
// pin chain: "inherit" (follow the tenant-wide pin), "custom" (a store-level
// URL, paid — charges only the devices in that store that are themselves
// inheriting), or "none" (blocks the tenant pin, store shows no pin). One
// shared Dialog is reused across rows (state: activeStore), mirroring
// components/device-pin-control.tsx's useTransition + sonner pattern.
//
// Rows render straight from props — never copied into state. The actions call
// revalidatePinSurfaces(), so the server re-renders this page inside the same
// transition; a local copy would keep showing the old effectiveUrl after a
// sibling OrgPinCard edit changed the tenant pin these rows inherit.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { setStorePinAction, setStorePinModeAction } from "@/lib/actions/pin";
import type { PinMode } from "@/lib/pin";

export interface StorePinRow {
  id: string;
  name: string;
  pinMode: PinMode;
  pinnedUrl: string | null;
  deviceCount: number;
  inheritingCount: number;
  effectiveUrl: string | null;
}

const MODE_LABEL: Record<PinMode, string> = {
  inherit: "Inherit",
  custom: "Custom",
  none: "None",
};

function ModeBadge({ mode }: { mode: PinMode }) {
  return (
    <Badge variant={mode === "inherit" ? "secondary" : mode === "custom" ? "default" : "outline"}>
      {MODE_LABEL[mode]}
    </Badge>
  );
}

export function StorePinTable(props: {
  stores: StorePinRow[];
  tenantPinnedUrl: string | null;
  creditsAvailable: number;
  canManage: boolean;
}) {
  const rows = props.stores;
  const [activeStore, setActiveStore] = useState<StorePinRow | null>(null);
  const [draftMode, setDraftMode] = useState<PinMode>("inherit");
  const [draftUrl, setDraftUrl] = useState("");
  const [pending, startTransition] = useTransition();

  function openManage(store: StorePinRow) {
    setActiveStore(store);
    setDraftMode(store.pinMode);
    setDraftUrl(store.pinnedUrl ?? "");
  }

  const isRealChange = activeStore
    ? draftMode !== activeStore.pinMode ||
      (draftMode === "custom" && draftUrl.trim() !== (activeStore.pinnedUrl ?? ""))
    : false;
  // Devices are billed when they END UP showing a pin they weren't showing
  // (lib/pin-resolve.ts), so leaving "none" for "inherit" while a tenant pin
  // exists costs the same as a custom set — it isn't a free mode flip.
  const inheritWillCharge =
    !!activeStore && draftMode === "inherit" && activeStore.pinMode === "none" && props.tenantPinnedUrl !== null;
  const chargeableDevices =
    activeStore && isRealChange && (draftMode === "custom" || inheritWillCharge)
      ? activeStore.inheritingCount
      : 0;
  const notEnoughCredits = chargeableDevices > props.creditsAvailable;

  function save() {
    if (!activeStore) return;
    const store = activeStore;
    startTransition(async () => {
      const res =
        draftMode === "custom"
          ? await setStorePinAction(store.id, draftUrl.trim())
          : await setStorePinModeAction(store.id, draftMode);
      if (!res.ok) {
        toast.error("Couldn't update store pin", { description: res.error });
        return;
      }
      setActiveStore(null);
      toast.success(
        draftMode === "custom"
          ? `Pinned on ${res.affectedDevices} device(s) — ${res.creditsCharged} credit(s)`
          : draftMode === "inherit"
            ? res.creditsCharged
              ? `Store now follows the tenant-wide pin — ${res.creditsCharged} credit(s)`
              : "Store now follows the tenant-wide pin"
            : "Store pin set to None — no pin shown",
      );
    });
  }

  return (
    <>
      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Store</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Pinned URL</TableHead>
              <TableHead>Devices</TableHead>
              {props.canManage && <TableHead className="w-28" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={props.canManage ? 5 : 4}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No stores yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>
                    <ModeBadge mode={s.pinMode} />
                  </TableCell>
                  <TableCell className="max-w-64 truncate font-mono text-xs text-muted-foreground">
                    {s.effectiveUrl ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.deviceCount}</TableCell>
                  {props.canManage && (
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => openManage(s)}>
                        Manage
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={activeStore !== null} onOpenChange={(o) => !o && setActiveStore(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{activeStore?.name ?? "Store"} pin</DialogTitle>
            <DialogDescription>
              Choose how this store's devices resolve a pinned QR when idle.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant={draftMode === "inherit" ? "default" : "outline"}
              onClick={() => setDraftMode("inherit")}
              disabled={pending}
            >
              Inherit
            </Button>
            <Button
              size="sm"
              variant={draftMode === "custom" ? "default" : "outline"}
              onClick={() => setDraftMode("custom")}
              disabled={pending}
            >
              Custom
            </Button>
            <Button
              size="sm"
              variant={draftMode === "none" ? "default" : "outline"}
              onClick={() => setDraftMode("none")}
              disabled={pending}
            >
              None
            </Button>
          </div>

          {draftMode === "inherit" && (
            <p className="text-sm text-muted-foreground">Follows the tenant-wide pin.</p>
          )}
          {inheritWillCharge && activeStore && (
            <p className="text-xs text-muted-foreground">
              Up to {activeStore.inheritingCount} device(s) start showing the tenant pin — up to{" "}
              {activeStore.inheritingCount} credit(s) (you have {props.creditsAvailable}).
            </p>
          )}
          {draftMode === "none" && (
            <p className="text-sm text-muted-foreground">This store's devices show no pin.</p>
          )}
          {draftMode === "custom" && (
            <>
              <Input
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder="https://example.com/menu"
                type="url"
                autoFocus
              />
              {activeStore && (
                <p className="text-xs text-muted-foreground">
                  Up to {activeStore.inheritingCount} device(s) — up to {activeStore.inheritingCount}{" "}
                  credit(s) (you have {props.creditsAvailable}).
                </p>
              )}
            </>
          )}
          {draftMode !== "custom" && !inheritWillCharge && (
            <p className="text-xs text-muted-foreground">Free.</p>
          )}

          <DialogFooter>
            <Button
              onClick={save}
              disabled={
                pending ||
                !isRealChange ||
                (draftMode === "custom" && draftUrl.trim().length === 0) ||
                notEnoughCredits
              }
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
          {notEnoughCredits && (
            <p className="text-xs text-destructive">Not enough credits — top up from Billing.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

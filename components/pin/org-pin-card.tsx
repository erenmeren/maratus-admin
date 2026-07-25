"use client";

// Tenant-wide pinned-QR card for /tenant/pinned-qr. Devices whose own mode is
// "inherit" AND whose store also inherits fall all the way through to this
// pin. Modeled directly on components/device-pin-control.tsx (same Card +
// Dialog + useTransition + toast + QrSvg preview treatment), scaled to the
// org-wide scope: cost previews use `reach` (device count) instead of a flat
// 1 credit, and success reports the real affected-device/credit charge.

import { useState, useTransition } from "react";
import { Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { QrSvg } from "@/components/qr-svg";
import { qrCornerRadiusPx, qrShadowBoxShadow } from "@/lib/qr-svg";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { setOrgPinAction, clearOrgPinAction } from "@/lib/actions/pin";
import { timeAgo } from "@/lib/format";
import type { QrStyle } from "@/lib/printer-layout";

// Matches the `size-32` (8rem = 128px) Tailwind utility on the <QrSvg> below.
const PIN_QR_DIM_PX = 128;

export function OrgPinCard(props: {
  tenant: { pinnedUrl: string | null; pinnedAt: string | null; reach: number };
  qrStyle: QrStyle;
  creditsAvailable: number;
  canManage: boolean;
}) {
  const [pinnedUrl, setPinnedUrl] = useState(props.tenant.pinnedUrl);
  const [pinnedAt, setPinnedAt] = useState(props.tenant.pinnedAt);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");
  const [pending, startTransition] = useTransition();

  const isChange = pinnedUrl !== null;
  const willCharge = draftUrl.trim() !== (pinnedUrl ?? "");
  const { reach } = props.tenant;
  const notEnoughCredits = willCharge && reach > props.creditsAvailable;

  function submit() {
    // Capture before dispatch: resubmitting the identical URL is a free
    // no-op server-side (pinnedAt untouched), so don't bump "Pinned …" then.
    const isRealChange = draftUrl.trim() !== (pinnedUrl ?? "");
    startTransition(async () => {
      const res = await setOrgPinAction(draftUrl.trim());
      if (!res.ok) {
        toast.error("Couldn't update pinned QR", { description: res.error });
        return;
      }
      setPinnedUrl(res.pinnedUrl ?? null);
      if (isRealChange) setPinnedAt(new Date().toISOString());
      setDialogOpen(false);
      toast.success(`Pinned on ${res.affectedDevices} device(s) — ${res.creditsCharged} credit(s)`);
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await clearOrgPinAction();
      if (!res.ok) {
        toast.error("Couldn't remove pinned QR", { description: res.error });
        return;
      }
      setPinnedUrl(null);
      setPinnedAt(null);
      toast.success(`Removed from ${res.affectedDevices} device(s)`);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Pin className="size-4" /> Tenant-wide pin
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {pinnedUrl ? (
          <>
            <QrSvg
              value={pinnedUrl}
              shape={props.qrStyle.qrShape}
              fg={props.qrStyle.qrFg}
              bg={props.qrStyle.qrBg}
              cornerRadius={props.qrStyle.qrCornerRadius}
              className="mx-auto block size-32 border p-1.5"
              style={{
                background: props.qrStyle.qrBg,
                // PIN_QR_DIM_PX matches the `size-32` (8rem = 128px) Tailwind
                // utility above — qrCornerRadiusPx/qrShadowBoxShadow need the
                // card's own real pixel size, not a fixed constant (see
                // lib/qr-svg.ts).
                borderRadius: qrCornerRadiusPx(PIN_QR_DIM_PX, props.qrStyle.qrCornerRadius),
                boxShadow: qrShadowBoxShadow(
                  props.qrStyle.qrShadowMode,
                  props.qrStyle.qrShadowStrength,
                  props.qrStyle.qrShadowColor,
                  PIN_QR_DIM_PX,
                ),
              }}
              ariaLabel="Tenant-wide pinned QR preview"
            />
            <p className="break-all font-mono text-xs text-muted-foreground">{pinnedUrl}</p>
            {pinnedAt && <p className="text-xs text-muted-foreground">Pinned {timeAgo(pinnedAt)}</p>}
            <p className="text-xs text-muted-foreground">Reaches {reach} device(s).</p>
          </>
        ) : (
          <p className="text-muted-foreground">
            No tenant-wide pin. Devices fall back to their store pin or idle screen.
          </p>
        )}
        {props.canManage && (
          <div className="flex gap-2">
            <Dialog
              open={dialogOpen}
              onOpenChange={(o) => {
                setDialogOpen(o);
                if (o) setDraftUrl(pinnedUrl ?? "");
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" variant={isChange ? "outline" : "default"} disabled={pending}>
                  {isChange ? "Change" : "Set pinned QR"}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>{isChange ? "Change tenant-wide pin" : "Set tenant-wide pin"}</DialogTitle>
                  <DialogDescription>
                    Pinning tenant-wide updates up to {reach} device(s) — up to {reach} credit(s) (you
                    have {props.creditsAvailable}). Removing is free.
                  </DialogDescription>
                </DialogHeader>
                <Input
                  value={draftUrl}
                  onChange={(e) => setDraftUrl(e.target.value)}
                  placeholder="https://example.com/menu"
                  type="url"
                  autoFocus
                />
                <DialogFooter>
                  <Button
                    onClick={submit}
                    disabled={pending || draftUrl.trim().length === 0 || notEnoughCredits}
                  >
                    {pending ? "Saving…" : willCharge ? `Pin (up to ${reach} credit(s))` : "Pin"}
                  </Button>
                </DialogFooter>
                {notEnoughCredits && (
                  <p className="text-xs text-destructive">Not enough credits — top up from Billing.</p>
                )}
              </DialogContent>
            </Dialog>
            {isChange && (
              <Button size="sm" variant="ghost" onClick={remove} disabled={pending}>
                <PinOff className="size-4" /> Remove
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

// Pinned-QR card for the tenant device detail page. Members see read-only
// state; owners/admins can set/change (1 credit) or remove (free) the pin.
//
// Re-enabling inherit from "none" also costs 1 credit when a store/tenant pin
// exists — the device goes from showing nothing to showing that pin, and the
// money rule bills the screen that lights up (lib/pin-resolve.ts).

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
import {
  setDevicePinAction,
  clearDevicePinAction,
  setDevicePinModeAction,
} from "@/lib/actions/pin";
import { timeAgo } from "@/lib/format";
import { DEFAULT_QR_STYLE, type QrShadowMode, type QrShape } from "@/lib/printer-layout";
import type { PinMode } from "@/lib/pin";

// Matches the `size-32` (8rem = 128px) Tailwind utility on the <QrSvg> below.
const PIN_QR_DIM_PX = 128;

export function DevicePinControl(props: {
  deviceId: string;
  initialPinnedUrl: string | null;
  initialPinnedAt: string | null;
  pinMode: PinMode;
  inheritedUrl: string | null;
  inheritedSource: "store" | "tenant" | null;
  creditsAvailable: number;
  canManage: boolean;
  /** Org-wide QR style (Branding → QR style); defaults match the org default look. */
  qrShape?: QrShape;
  qrFg?: string;
  qrBg?: string;
  qrCornerRadius?: number;
  qrShadowMode?: QrShadowMode;
  qrShadowStrength?: number;
  qrShadowColor?: string;
}) {
  const [pinnedUrl, setPinnedUrl] = useState(props.initialPinnedUrl);
  const [pinnedAt, setPinnedAt] = useState(props.initialPinnedAt);
  const [mode, setMode] = useState(props.pinMode);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");
  const [pending, startTransition] = useTransition();

  const isChange = mode === "custom";
  const willCharge = draftUrl.trim() !== (pinnedUrl ?? "");
  // "none" → "inherit" lights the device up with the store/tenant pin, so it
  // bills 1 credit; with nothing to inherit it stays free.
  const reenableCharges = mode === "none" && props.inheritedUrl !== null;

  function submit() {
    // Capture before dispatch: resubmitting the identical URL is a free
    // no-op server-side (pinnedAt untouched), so don't bump "Pinned …" then.
    const isRealChange = draftUrl.trim() !== (pinnedUrl ?? "");
    startTransition(async () => {
      const res = await setDevicePinAction(props.deviceId, draftUrl.trim());
      if (!res.ok) {
        toast.error("Couldn't update pinned QR", { description: res.error });
        return;
      }
      setPinnedUrl(res.pinnedUrl ?? null);
      if (isRealChange) setPinnedAt(new Date().toISOString());
      setMode("custom");
      setDialogOpen(false);
      toast.success("Pinned QR updated");
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await clearDevicePinAction(props.deviceId);
      if (!res.ok) {
        toast.error("Couldn't remove pinned QR", { description: res.error });
        return;
      }
      setPinnedUrl(null);
      setPinnedAt(null);
      setMode("inherit");
      toast.success("Pin removed — device now follows the store/tenant pin");
    });
  }

  function disablePin() {
    startTransition(async () => {
      const res = await setDevicePinModeAction(props.deviceId, "none");
      if (!res.ok) {
        toast.error("Couldn't disable pin", { description: res.error });
        return;
      }
      setMode("none");
      toast.success("Pin disabled for this device");
    });
  }

  function reenableInherit() {
    startTransition(async () => {
      const res = await setDevicePinModeAction(props.deviceId, "inherit");
      if (!res.ok) {
        toast.error("Couldn't re-enable inherit", { description: res.error });
        return;
      }
      setMode("inherit");
      toast.success("Device now follows the store/tenant pin");
    });
  }

  function qrPreview(url: string) {
    return (
      <QrSvg
        value={url}
        shape={props.qrShape ?? DEFAULT_QR_STYLE.qrShape}
        fg={props.qrFg ?? DEFAULT_QR_STYLE.qrFg}
        bg={props.qrBg ?? DEFAULT_QR_STYLE.qrBg}
        cornerRadius={props.qrCornerRadius ?? DEFAULT_QR_STYLE.qrCornerRadius}
        className="mx-auto block size-32 border p-1.5"
        style={{
          background: props.qrBg ?? DEFAULT_QR_STYLE.qrBg,
          // PIN_QR_DIM_PX matches the `size-32` (8rem = 128px) Tailwind
          // utility above — qrCornerRadiusPx/qrShadowBoxShadow need the
          // card's own real pixel size, not a fixed constant (see
          // lib/qr-svg.ts).
          borderRadius: qrCornerRadiusPx(PIN_QR_DIM_PX, props.qrCornerRadius ?? DEFAULT_QR_STYLE.qrCornerRadius),
          boxShadow: qrShadowBoxShadow(
            props.qrShadowMode ?? DEFAULT_QR_STYLE.qrShadowMode,
            props.qrShadowStrength ?? DEFAULT_QR_STYLE.qrShadowStrength,
            props.qrShadowColor ?? DEFAULT_QR_STYLE.qrShadowColor,
            PIN_QR_DIM_PX,
          ),
        }}
        ariaLabel="Pinned QR preview"
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Pin className="size-4" /> Pinned QR
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {mode === "custom" && pinnedUrl && (
          <>
            {qrPreview(pinnedUrl)}
            <p className="break-all font-mono text-xs text-muted-foreground">{pinnedUrl}</p>
            {pinnedAt && (
              <p className="text-xs text-muted-foreground">Pinned {timeAgo(pinnedAt)}</p>
            )}
          </>
        )}
        {mode === "inherit" && props.inheritedUrl && (
          <>
            {qrPreview(props.inheritedUrl)}
            <p className="break-all font-mono text-xs text-muted-foreground">
              {props.inheritedUrl}
            </p>
            <p className="text-xs text-muted-foreground">
              Inherited from the {props.inheritedSource ?? "store"} pin
            </p>
          </>
        )}
        {mode === "inherit" && !props.inheritedUrl && (
          <p className="text-muted-foreground">
            No pinned QR. The device shows its idle screen when not triggered.
          </p>
        )}
        {mode === "none" && (
          <p className="text-muted-foreground">
            Pin disabled for this device — it always shows its idle screen.
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
                  <DialogTitle>{isChange ? "Change pinned QR" : "Set pinned QR"}</DialogTitle>
                  <DialogDescription>
                    The device will show this URL as a QR whenever it is idle. Changing the
                    URL uses <strong>1 credit</strong> (you have {props.creditsAvailable}).
                    Removing a pin is free.
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
                    disabled={
                      pending ||
                      draftUrl.trim().length === 0 ||
                      (willCharge && props.creditsAvailable < 1)
                    }
                  >
                    {pending ? "Saving…" : willCharge ? "Pin (1 credit)" : "Pin"}
                  </Button>
                </DialogFooter>
                {willCharge && props.creditsAvailable < 1 && (
                  <p className="text-xs text-destructive">Not enough credits — top up from Billing.</p>
                )}
              </DialogContent>
            </Dialog>
            {mode === "custom" && (
              <Button size="sm" variant="ghost" onClick={remove} disabled={pending}>
                <PinOff className="size-4" /> Remove
              </Button>
            )}
            {mode === "inherit" && props.inheritedUrl && (
              <Button size="sm" variant="ghost" onClick={disablePin} disabled={pending}>
                <PinOff className="size-4" /> Don&apos;t pin here
              </Button>
            )}
            {mode === "none" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={reenableInherit}
                disabled={pending || (reenableCharges && props.creditsAvailable < 1)}
              >
                <Pin className="size-4" />{" "}
                {reenableCharges ? "Re-enable inherit (1 credit)" : "Re-enable inherit"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

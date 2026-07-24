"use client";

// Pinned-QR card for the tenant device detail page. Members see read-only
// state; owners/admins can set/change (1 credit) or remove (free) the pin.

import { useState, useTransition } from "react";
import { Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { QrSvg } from "@/components/qr-svg";
import { qrShadowBoxShadow } from "@/lib/qr-svg";
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
import { setDevicePinAction, clearDevicePinAction } from "@/lib/actions/pin";
import { timeAgo } from "@/lib/format";
import { DEFAULT_QR_STYLE, type QrCorner, type QrShadowMode, type QrShape } from "@/lib/printer-layout";
import { cn } from "@/lib/utils";

export function DevicePinControl(props: {
  deviceId: string;
  initialPinnedUrl: string | null;
  initialPinnedAt: string | null;
  creditsAvailable: number;
  canManage: boolean;
  /** Org-wide QR style (Branding → QR style); defaults match the org default look. */
  qrShape?: QrShape;
  qrFg?: string;
  qrBg?: string;
  qrCorner?: QrCorner;
  qrShadowMode?: QrShadowMode;
  qrShadowStrength?: number;
  qrShadowColor?: string;
}) {
  const [pinnedUrl, setPinnedUrl] = useState(props.initialPinnedUrl);
  const [pinnedAt, setPinnedAt] = useState(props.initialPinnedAt);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");
  const [pending, startTransition] = useTransition();

  const isChange = pinnedUrl !== null;
  const willCharge = draftUrl.trim() !== (pinnedUrl ?? "");

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
      toast.success("Pinned QR removed");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Pin className="size-4" /> Pinned QR
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {pinnedUrl ? (
          <>
            <QrSvg
              value={pinnedUrl}
              shape={props.qrShape ?? DEFAULT_QR_STYLE.qrShape}
              fg={props.qrFg ?? DEFAULT_QR_STYLE.qrFg}
              bg={props.qrBg ?? DEFAULT_QR_STYLE.qrBg}
              corner={props.qrCorner ?? DEFAULT_QR_STYLE.qrCorner}
              className={cn(
                "mx-auto block size-32 border p-1.5",
                (props.qrCorner ?? DEFAULT_QR_STYLE.qrCorner) === "rounded" ? "rounded-lg" : "rounded-none",
              )}
              style={{
                background: props.qrBg ?? DEFAULT_QR_STYLE.qrBg,
                boxShadow: qrShadowBoxShadow(
                  props.qrShadowMode ?? DEFAULT_QR_STYLE.qrShadowMode,
                  props.qrShadowStrength ?? DEFAULT_QR_STYLE.qrShadowStrength,
                  props.qrShadowColor ?? DEFAULT_QR_STYLE.qrShadowColor,
                ),
              }}
              ariaLabel="Pinned QR preview"
            />
            <p className="break-all font-mono text-xs text-muted-foreground">{pinnedUrl}</p>
            {pinnedAt && (
              <p className="text-xs text-muted-foreground">Pinned {timeAgo(pinnedAt)}</p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">
            No pinned QR. The device shows its idle screen when not triggered.
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

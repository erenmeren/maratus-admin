"use client";

// Pinned-QR card for the tenant device detail page. Members see read-only
// state; owners/admins can set/change (1 credit) or remove (free) the pin.

import { useEffect, useState, useTransition } from "react";
import { Pin, PinOff } from "lucide-react";
import QRCode from "qrcode";
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

export function DevicePinControl(props: {
  deviceId: string;
  initialPinnedUrl: string | null;
  initialPinnedAt: string | null;
  creditsAvailable: number;
  canManage: boolean;
}) {
  const [pinnedUrl, setPinnedUrl] = useState(props.initialPinnedUrl);
  const [pinnedAt, setPinnedAt] = useState(props.initialPinnedAt);
  // Tracks which URL the cached data-URL was rendered for, so a stale QR
  // never flashes for a different (or removed) pinned URL.
  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!pinnedUrl) return;
    let cancelled = false;
    QRCode.toDataURL(pinnedUrl, { margin: 1, width: 192 }).then((dataUrl) => {
      if (!cancelled) setQr({ url: pinnedUrl, dataUrl });
    });
    return () => {
      cancelled = true;
    };
  }, [pinnedUrl]);

  const qrDataUrl = qr && qr.url === pinnedUrl ? qr.dataUrl : null;

  const isChange = pinnedUrl !== null;
  const willCharge = draftUrl.trim() !== (pinnedUrl ?? "");

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await setDevicePinAction(props.deviceId, draftUrl.trim());
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      setPinnedUrl(res.pinnedUrl ?? null);
      setPinnedAt(new Date().toISOString());
      setDialogOpen(false);
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await clearDevicePinAction(props.deviceId);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      setPinnedUrl(null);
      setPinnedAt(null);
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
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="Pinned QR preview"
                className="mx-auto size-32 rounded-lg border bg-white p-1.5"
              />
            )}
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
        {error && <p className="text-xs text-destructive">{error}</p>}
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

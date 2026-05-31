"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { claimDeviceAction } from "@/app/(tenant)/tenant/stores/[storeId]/actions";
import { cn } from "@/lib/utils";

export function ClaimDeviceDialog({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  // After a successful claim we show the one-time key instead of the form.
  const [issued, setIssued] = React.useState<{
    deviceName: string;
    deviceKey: string;
  } | null>(null);

  function reset() {
    setCode("");
    setLoading(false);
    setCopied(false);
    setIssued(null);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Refresh the store page if we just claimed something, then clear state.
      if (issued) router.refresh();
      // Delay reset so the closing animation doesn't flash the form.
      setTimeout(reset, 150);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const res = await claimDeviceAction(storeId, code);
    setLoading(false);
    if (!res.ok) {
      toast.error("Couldn't claim device", { description: res.error });
      return;
    }
    setIssued({ deviceName: res.deviceName!, deviceKey: res.deviceKey! });
    router.refresh();
  }

  async function copyKey() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.deviceKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Copy failed — select and copy manually.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Claim kiosk
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {!issued ? (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Claim a kiosk</DialogTitle>
              <DialogDescription>
                Enter the pairing code shown on the kiosk screen to bind it to
                this store.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2 py-4">
              <Label htmlFor="pairingCode">Pairing code</Label>
              <Input
                id="pairingCode"
                name="pairingCode"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="font-mono tracking-[0.18em]"
                required
              />
              <p className="text-xs text-muted-foreground">
                Find it under Settings → Pairing on the device.
              </p>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={loading || !code.trim()}>
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <KeyRound className="size-4" />
                )}
                {loading ? "Claiming…" : "Claim kiosk"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-md bg-status-online/15 text-status-online">
                  <Check className="size-4" />
                </span>
                {issued.deviceName} claimed
              </DialogTitle>
              <DialogDescription>
                Save this device key now — it’s shown only once and can’t be
                retrieved later.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-4">
              <div className="flex items-start gap-2 rounded-lg border border-status-paused/30 bg-status-paused/10 p-3 text-xs text-status-paused">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  Store it in the device’s configuration now. For security, Ditto
                  only keeps a hashed copy.
                </span>
              </div>

              <div className="space-y-2">
                <Label>Device key</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md border bg-muted px-3 py-2 font-mono text-xs">
                    {issued.deviceKey}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={copyKey}
                    aria-label="Copy device key"
                  >
                    {copied ? (
                      <Check className={cn("size-4 text-status-online")} />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button">Done</Button>
              </DialogClose>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

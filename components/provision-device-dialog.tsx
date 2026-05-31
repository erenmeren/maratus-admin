"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Cpu, Loader2, Plus, TriangleAlert } from "lucide-react";
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
import { provisionDevice } from "@/lib/actions/devices";

const NO_STORE = "__none__";

export function ProvisionDeviceDialog({
  organizationId,
  customerName,
  stores,
}: {
  organizationId: string;
  customerName: string;
  stores: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [storeId, setStoreId] = React.useState<string>(NO_STORE);
  const [pending, setPending] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [issued, setIssued] = React.useState<{
    deviceId: string;
    pairingCode: string;
  } | null>(null);

  function reset() {
    setName("");
    setStoreId(NO_STORE);
    setPending(false);
    setCopied(false);
    setIssued(null);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      if (issued) router.refresh();
      setTimeout(reset, 150);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const res = await provisionDevice(
      organizationId,
      name,
      storeId === NO_STORE ? null : storeId,
    );
    setPending(false);
    if (!res.ok) {
      toast.error("Couldn't add device", { description: res.error });
      return;
    }
    setIssued({ deviceId: res.deviceId!, pairingCode: res.pairingCode! });
    router.refresh();
  }

  async function copyCode() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Copy failed — select and copy manually.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          Add device
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {!issued ? (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Add device</DialogTitle>
              <DialogDescription>
                Provision a new kiosk for {customerName}. You&apos;ll get a
                pairing code to enter on the device.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="device-name">Device name</Label>
                <Input
                  id="device-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Kiosk 1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="device-store">Store (optional)</Label>
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger id="device-store" className="w-full">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_STORE}>Unassigned</SelectItem>
                    {stores.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Leave unassigned to let the tenant claim it into a store.
                </p>
              </div>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Cpu className="size-4" />
                )}
                {pending ? "Adding…" : "Add device"}
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
                Device provisioned
              </DialogTitle>
              <DialogDescription>
                Enter this pairing code on the kiosk to bind it, then it issues
                its device key.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-4">
              <div className="flex items-start gap-2 rounded-lg border border-status-paused/30 bg-status-paused/10 p-3 text-xs text-status-paused">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  The device stays “offline” until it pairs with this code.
                </span>
              </div>
              <div className="space-y-2">
                <Label>Pairing code</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-center font-mono text-base tracking-[0.3em]">
                    {issued.pairingCode}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={copyCode}
                    aria-label="Copy pairing code"
                  >
                    {copied ? (
                      <Check className="size-4 text-status-online" />
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

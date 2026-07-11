"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Store as StoreIcon } from "lucide-react";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { assignDeviceToStore } from "@/lib/actions/devices";

/** Tenant-side "move this printer to another branch" (owner/admin; server re-checks). */
export function DeviceMoveControl({
  deviceId,
  deviceName,
  stores,
}: {
  deviceId: string;
  deviceName: string;
  stores: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [target, setTarget] = React.useState("");

  async function onConfirm() {
    if (!target) return;
    setPending(true);
    const res = await assignDeviceToStore(deviceId, target);
    setPending(false);
    if (!res.ok) {
      toast.error("Couldn't move device", { description: res.error });
      return;
    }
    toast.success("Device moved");
    setOpen(false);
    router.push(`/tenant/stores/${target}/${deviceId}`);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <StoreIcon className="size-4" />
        Move to store
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Move device</DialogTitle>
            <DialogDescription>
              Move <span className="font-medium">{deviceName}</span> to another
              branch. It keeps its key, history, and settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a store" />
              </SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button disabled={pending || !target} onClick={onConfirm}>
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
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
import { deleteDevice } from "@/lib/actions/devices";

/** Delete affordance for an UNCLAIMED (provisioned, never-claimed) device on the
 *  admin fleet list. Claimed devices are managed from their detail page; an
 *  unclaimed device has no other home in the UI, so this is the only way to
 *  remove a provisioned-but-never-claimed row (e.g. a mistaken provision or a
 *  pairing code that will never be used). */
export function UnclaimedDeviceDelete({
  deviceId,
  deviceName,
}: {
  deviceId: string;
  deviceName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function onDelete() {
    setPending(true);
    const res = await deleteDevice(deviceId);
    setPending(false);
    if (!res.ok) {
      toast.error("Couldn't delete device", { description: res.error });
      return;
    }
    setOpen(false);
    toast.success("Device deleted");
    router.refresh();
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground hover:text-destructive"
        onClick={() => setOpen(true)}
        aria-label={`Delete ${deviceName}`}
      >
        <Trash2 className="size-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete unclaimed device?</DialogTitle>
            <DialogDescription>
              This permanently removes <span className="font-medium">{deviceName}</span> and
              its pairing code. It has never been claimed, so no store or activation
              history is affected. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button variant="destructive" disabled={pending} onClick={onDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimezoneSelect } from "@/components/timezone-select";
import { normalizeTimezone } from "@/lib/timezones";
import { updateStore } from "@/lib/actions/stores";

export function EditStoreDialog({
  store,
  open,
  onOpenChange,
}: {
  store: { id: string; name: string; address: string; timezone: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [timezone, setTimezone] = React.useState(normalizeTimezone(store.timezone));

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("timezone", timezone);
    setPending(true);
    const res = await updateStore(store.id, fd);
    setPending(false);
    if (!res.ok) {
      toast.error("Couldn't save store", { description: res.error });
      return;
    }
    onOpenChange(false);
    toast.success("Store updated");
    router.refresh();
  }

  return (
    <Dialog key={store.id} open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit store</DialogTitle>
            <DialogDescription>Update this branch's details.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Store name</Label>
              <Input id="edit-name" name="name" defaultValue={store.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-address">Address</Label>
              <Input id="edit-address" name="address" defaultValue={store.address} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-timezone">Timezone</Label>
              <TimezoneSelect
                id="edit-timezone"
                value={timezone}
                onValueChange={setTimezone}
              />
              <p className="text-xs text-muted-foreground">
                The store’s local time zone.
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
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

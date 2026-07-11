"use client";

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

/** Shared confirm dialog for store deletion (tenant + admin wire their own action). */
export function DeleteStoreDialog({
  storeName,
  deviceCount,
  armedCount,
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  storeName: string;
  deviceCount: number;
  armedCount: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete store?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                This permanently deletes <span className="font-medium">{storeName}</span>.
              </p>
              {deviceCount > 0 && (
                <p>
                  {deviceCount} {deviceCount === 1 ? "device" : "devices"} will move to{" "}
                  <span className="font-medium">Unassigned devices</span> and can be
                  assigned to another store later.
                </p>
              )}
              {armedCount > 0 && (
                <p className="text-amber-600 dark:text-amber-500">
                  {armedCount} {armedCount === 1 ? "device" : "devices"} prepared for
                  zero-touch setup will need to be re-armed by Ditto.
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            Delete store
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

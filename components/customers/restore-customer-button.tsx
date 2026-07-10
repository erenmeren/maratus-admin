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
  DialogTrigger,
} from "@/components/ui/dialog";
import { restoreCustomerAction } from "@/lib/actions/offboarding";

export function RestoreCustomerButton({
  organizationId,
}: {
  organizationId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function onConfirm() {
    setBusy(true);
    try {
      const res = await restoreCustomerAction(organizationId);
      if (!res.ok) {
        toast.error(res.error ?? "Failed to restore customer.");
        return;
      }
      toast.success("Customer restored.");
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Failed to restore customer — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Restore customer</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Restore customer?</DialogTitle>
          <DialogDescription>
            Members can sign in again. The following are deliberately NOT
            undone:
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>revoked API keys (new ones are created normally),</li>
          <li>
            device dispositions (returned stock re-enters via normal
            allocation/claim),
          </li>
          <li>cancelled invitations.</li>
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button disabled={busy} onClick={onConfirm}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? "Restoring…" : "Restore customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

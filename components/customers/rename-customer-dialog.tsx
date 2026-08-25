"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
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
import { renameCustomerAction } from "@/lib/actions/customers";

export function RenameCustomerDialog({
  organizationId,
  currentName,
}: {
  organizationId: string;
  currentName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(currentName);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Reopening after a failed edit should start from the saved name again.
    if (!next) {
      setName(currentName);
      setError(null);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await renameCustomerAction(organizationId, name);
      if (!res.ok) {
        setError(res.error ?? "Couldn't rename this customer.");
        return;
      }
      setOpen(false);
      toast.success("Customer renamed");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Pencil className="size-4" />
          Rename
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename customer</DialogTitle>
          <DialogDescription>
            Change the company name shown across the admin console and the
            customer&apos;s own workspace.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rename-customer-name">Company name</Label>
            <Input
              id="rename-customer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save name
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

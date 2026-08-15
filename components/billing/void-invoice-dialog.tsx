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
import { voidInvoiceAction } from "@/lib/actions/invoices";
import { formatUsdCents } from "@/lib/format";

/**
 * Cancels an invoice issued by mistake. Without this an accidental
 * "Start subscription" click leaves a full-year invoice open forever: it
 * cannot be paid away without moving money, and it drags the customer into
 * the overdue view.
 */
export function VoidInvoiceDialog({
  invoiceId,
  amountUsdCents,
}: {
  invoiceId: string;
  amountUsdCents: number;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleVoid() {
    setError(null);
    setPending(true);
    try {
      const res = await voidInvoiceAction(invoiceId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("Invoice voided.");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Something went wrong — try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Void
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Void this invoice?</DialogTitle>
          <DialogDescription>
            {formatUsdCents(amountUsdCents)} will be cancelled. Nothing is
            activated or deactivated — the invoice simply stops being owed and
            drops out of the overdue list. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="pb-2 text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={handleVoid}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {pending ? "Voiding…" : "Void invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

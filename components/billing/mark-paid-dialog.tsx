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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { markInvoicePaidAction } from "@/lib/actions/invoices";
import { formatUsdCents } from "@/lib/format";

export function MarkPaidDialog({
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fd = new FormData(e.currentTarget);
    // Inputs are decimal TRY / decimal TRY-per-USD; the server stores both
    // as whole kuruş, so the conversion (and its rounding) happens once,
    // right here at the input edge — never on money already at rest.
    const tryAmountKurus = Math.round(Number(fd.get("tryAmount")) * 100);
    const fxRate = Math.round(Number(fd.get("fxRate")) * 100);

    if (!Number.isInteger(tryAmountKurus) || tryAmountKurus <= 0) {
      setError("Enter a valid transferred amount (TRY).");
      return;
    }
    if (!Number.isInteger(fxRate) || fxRate <= 0) {
      setError("Enter a valid FX rate (TRY per USD).");
      return;
    }

    setPending(true);
    try {
      const res = await markInvoicePaidAction({
        invoiceId,
        tryAmountKurus,
        fxRate,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("Invoice marked paid.");
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
        <Button size="sm" variant="outline">
          Mark paid
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Mark invoice paid</DialogTitle>
            <DialogDescription>
              {formatUsdCents(amountUsdCents)} due. Record the bank transfer
              as received, in TRY, plus the FX rate used — this activates the
              devices it covers.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="try-amount">Amount transferred (TRY)</Label>
              <Input
                id="try-amount"
                name="tryAmount"
                type="number"
                min={0.01}
                step={0.01}
                required
                placeholder="e.g. 15000.00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx-rate">FX rate (TRY per USD)</Label>
              <Input
                id="fx-rate"
                name="fxRate"
                type="number"
                min={0.01}
                step={0.01}
                required
                placeholder="e.g. 34.50"
              />
            </div>
          </div>

          {error && <p className="pb-2 text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {pending ? "Marking paid…" : "Mark paid"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

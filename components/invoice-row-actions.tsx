"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MoreHorizontal, Send, Ban } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { advanceInvoice, setInvoiceStatus, voidInvoice } from "@/lib/actions/billing";
import type { InvoiceLifecycle } from "@/lib/types";

export function InvoiceRowActions({
  invoiceId,
  lifecycle,
}: {
  invoiceId: string;
  lifecycle: InvoiceLifecycle;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  if (lifecycle === "paid") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Check className="size-3.5 text-status-online" />
        Settled
      </span>
    );
  }

  if (lifecycle === "void") {
    return <span className="text-xs text-muted-foreground">Void</span>;
  }

  async function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    ok: string,
  ) {
    setPending(true);
    const res = await fn();
    setPending(false);
    if (!res.ok) {
      toast.error("Action failed", { description: res.error });
      return;
    }
    toast.success(ok);
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MoreHorizontal className="size-4" />
          )}
          <span className="sr-only">Invoice actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {lifecycle === "draft" && (
          <DropdownMenuItem
            onClick={() => run(() => advanceInvoice(invoiceId), "Invoice sent")}
          >
            <Send className="size-4" /> Mark as sent
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() =>
            run(() => setInvoiceStatus(invoiceId, "paid"), "Invoice marked paid")
          }
        >
          <Check className="size-4" /> Mark as paid
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => run(() => voidInvoice(invoiceId), "Invoice voided")}
        >
          <Ban className="size-4" /> Void
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

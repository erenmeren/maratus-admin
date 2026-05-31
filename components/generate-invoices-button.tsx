"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateInvoices } from "@/lib/actions/billing";

export function GenerateInvoicesButton() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function run() {
    setPending(true);
    const res = await generateInvoices();
    setPending(false);
    if (!res.ok) {
      toast.error("Couldn't generate invoices", { description: res.error });
      return;
    }
    const parts: string[] = [];
    if (res.created) parts.push(`${res.created} created`);
    if (res.updated) parts.push(`${res.updated} refreshed`);
    toast.success(`Invoices for ${res.period}`, {
      description: parts.length
        ? parts.join(" · ")
        : "All invoices already up to date.",
    });
    router.refresh();
  }

  return (
    <Button onClick={run} disabled={pending}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <FileText className="size-4" />
      )}
      {pending ? "Generating…" : "Generate invoices"}
    </Button>
  );
}

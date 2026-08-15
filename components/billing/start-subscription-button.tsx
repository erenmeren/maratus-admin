"use client";

// Small client island so `SubscriptionCard` itself can stay a server
// component: this is the only interactive bit it needs besides the
// mark-paid dialog, and `startSubscriptionAction` returns a value (not
// void), which a bare `<form action={...}>` can't be typed against.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startSubscriptionAction } from "@/lib/actions/invoices";

export function StartSubscriptionButton({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function onClick() {
    setPending(true);
    try {
      const res = await startSubscriptionAction(tenantId);
      if (!res.ok) {
        toast.error("Couldn't start subscription", { description: res.error });
        return;
      }
      toast.success("Subscription started — invoice issued.");
      router.refresh();
    } catch {
      toast.error("Couldn't start subscription — try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button onClick={onClick} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {pending ? "Starting…" : "Start subscription"}
    </Button>
  );
}

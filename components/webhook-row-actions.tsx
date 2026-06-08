"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Power, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteWebhookEndpoint, setWebhookEndpointEnabled, sendTestEvent } from "@/lib/actions/webhooks";

export function WebhookRowActions({ endpointId, enabled }: { endpointId: string; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; responseStatus?: number | null }>, okMsg: string) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      toast.error("Action failed", { description: res.error ?? (res.responseStatus != null ? `HTTP ${res.responseStatus}` : undefined) });
    } else {
      toast.success(okMsg + (res.responseStatus != null ? ` (HTTP ${res.responseStatus})` : ""));
    }
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" disabled={busy}>
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Endpoint actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => run(() => sendTestEvent(endpointId), "Test event sent")}>
          <Send className="size-4" />
          Send test event
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run(() => setWebhookEndpointEnabled(endpointId, !enabled), enabled ? "Disabled" : "Enabled")}>
          <Power className="size-4" />
          {enabled ? "Disable" : "Enable"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive"
          onSelect={() => run(() => deleteWebhookEndpoint(endpointId), "Endpoint deleted")}
        >
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

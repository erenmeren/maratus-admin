"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWebhookEndpoint } from "@/lib/actions/webhooks";

const EVENT_TYPES = ["document.created", "document.downloaded"];

export function WebhookCreateDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  function reset() {
    setSecret(null);
    setCopied(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    const res = await createWebhookEndpoint(fd);
    setPending(false);
    if (!res.ok || !res.secret) {
      toast.error("Couldn't create endpoint", { description: res.error });
      return;
    }
    setSecret(res.secret);
    router.refresh();
  }

  async function copy() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    toast.success("Copied to clipboard");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Add endpoint
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>Endpoint created</DialogTitle>
              <DialogDescription>
                Your signing secret — copy it now, you won&apos;t see it again.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 py-4">
              <code className="flex-1 truncate rounded bg-muted px-3 py-2 font-mono text-xs">{secret}</code>
              <Button type="button" variant="outline" size="icon" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button type="button">Done</Button></DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Add webhook endpoint</DialogTitle>
              <DialogDescription>We POST signed events to this HTTPS URL.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="wh-url">Endpoint URL</Label>
                <Input id="wh-url" name="url" type="url" placeholder="https://example.com/webhooks/ditto" required />
              </div>
              <div className="space-y-2">
                <Label>Events</Label>
                {EVENT_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="events" value={t} defaultChecked className="size-4" />
                    <code className="font-mono text-xs">{t}</code>
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {pending ? "Creating…" : "Create endpoint"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

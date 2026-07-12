"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, Copy, Mail, UserPlus } from "lucide-react";
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
import { inviteOwnerAction, type InviteOwnerState } from "@/lib/actions/customers";
import { cn } from "@/lib/utils";

const initialState: InviteOwnerState = { ok: true };

export function InviteOwnerDialog({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [state, formAction, pending] = useActionState(inviteOwnerAction, initialState);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setCopied(false);
  }

  async function copyLink() {
    if (!state.url) return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Copy failed — select and copy manually.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <UserPlus className="size-4" />
          Invite owner
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite owner</DialogTitle>
          <DialogDescription>
            Send this customer their first sign-in — they&apos;ll join as the
            org owner and can invite the rest of their team from there.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="organizationId" value={organizationId} />

          <div className="space-y-1.5">
            <Label htmlFor="invite-owner-email">Email</Label>
            <Input
              id="invite-owner-email"
              name="email"
              type="email"
              placeholder="owner@customer.com"
              autoComplete="off"
              required
            />
          </div>

          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}

          {state.ok && state.url && (
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
              <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Mail className="size-3.5" />
                Accept link
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={state.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyLink}
                  aria-label="Copy accept link"
                >
                  {copied ? (
                    <Check className={cn("size-4 text-status-online")} />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {state.emailed
                  ? "Invitation email sent."
                  : "Email delivery is not configured — copy the link and send it yourself."}
              </p>
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {state.ok && state.url ? "Done" : "Cancel"}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

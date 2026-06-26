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
import { createApiKey } from "@/lib/actions/api-keys";
import { API_SCOPES, DEFAULT_KEY_SCOPES } from "@/lib/api-scopes";

export function ApiKeyCreateDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [createdKey, setCreatedKey] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  function reset() {
    setCreatedKey(null);
    setCopied(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    const res = await createApiKey(fd);
    setPending(false);
    if (!res.ok || !res.key) {
      toast.error("Couldn't create key", { description: res.error });
      return;
    }
    setCreatedKey(res.key);
    router.refresh();
  }

  async function copy() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    toast.success("Copied to clipboard");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Create API key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {createdKey ? (
          <>
            <DialogHeader>
              <DialogTitle>API key created</DialogTitle>
              <DialogDescription>
                Copy it now — you won&apos;t be able to see it again.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 py-4">
              <code className="flex-1 truncate rounded bg-muted px-3 py-2 font-mono text-xs">
                {createdKey}
              </code>
              <Button type="button" variant="outline" size="icon" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button">Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                A read-only key scoped to this organization.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="key-name">Name</Label>
                <Input id="key-name" name="name" placeholder="e.g. Analytics export" required />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Permissions</legend>
                {API_SCOPES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="scope" value={s} defaultChecked={DEFAULT_KEY_SCOPES.includes(s)} />
                    <span className="font-mono">{s}</span>
                  </label>
                ))}
                <p className="text-xs text-muted-foreground">devices:trigger lets this key trigger devices and spend credits.</p>
              </fieldset>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {pending ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

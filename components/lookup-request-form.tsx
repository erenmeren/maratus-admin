"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { requestLookupLink } from "@/app/(public)/d/lookup/actions";

export function LookupRequestForm({ orgId }: { orgId: string }) {
  const [pending, setPending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [emailError, setEmailError] = React.useState<string | undefined>();

  async function action(formData: FormData) {
    const email = String(formData.get("email") ?? "").trim();
    if (!email) {
      setEmailError("Please enter your email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Please enter a valid email address.");
      return;
    }

    setEmailError(undefined);
    setPending(true);
    try {
      await requestLookupLink(formData);
      setSent(true);
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="px-6 py-5 text-center text-sm text-muted-foreground">
        If we have documents for that email, we&apos;ve sent you a link.
      </div>
    );
  }

  return (
    <div className="px-6 py-5">
      <form action={action} noValidate className="flex flex-col gap-3">
        <input type="hidden" name="orgId" value={orgId} />
        <div>
          <Label htmlFor="lookup-email-input" className="sr-only">
            Email address
          </Label>
          <Input
            id="lookup-email-input"
            name="email"
            type="email"
            placeholder="you@example.com"
            required
            aria-invalid={emailError ? true : undefined}
            onChange={() => setEmailError(undefined)}
          />
          {emailError && (
            <span className="mt-1 block text-xs text-destructive">{emailError}</span>
          )}
        </div>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Sending…" : "Find my documents"}
        </Button>
      </form>
    </div>
  );
}

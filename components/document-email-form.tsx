"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { requestDocumentEmail } from "@/app/(public)/d/lookup/actions";

export function DocumentEmailForm({
  token,
  organizationId,
  accent,
}: {
  token: string;
  organizationId: string;
  accent: string;
}) {
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
      await requestDocumentEmail(formData);
      setSent(true);
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="border-t px-6 py-5 text-center text-sm text-muted-foreground">
        Check your inbox — if everything&apos;s set up, your document is on its way.
      </div>
    );
  }

  return (
    <div className="border-t px-6 py-5">
      <p className="mb-3 text-sm font-medium">Email me this document</p>
      <form action={action} noValidate className="flex flex-col gap-3">
        <input type="hidden" name="token" value={token} />
        <div>
          <Label htmlFor="doc-email-input" className="sr-only">
            Email address
          </Label>
          <Input
            id="doc-email-input"
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
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" name="optIn" />
          Keep me posted with offers from this store
        </label>
        <Button
          type="submit"
          disabled={pending}
          className="w-full text-white"
          style={{ backgroundColor: accent }}
        >
          {pending ? "Sending…" : "Send to my inbox"}
        </Button>
      </form>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        <a
          href={`/d/lookup/${organizationId}`}
          className="font-medium hover:underline"
        >
          Find my other documents
        </a>
      </p>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { MailCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DittoWordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { authClient } from "@/lib/auth-client";

export function VerifyEmailNotice({ email }: { email?: string }) {
  const [sending, setSending] = React.useState(false);

  async function resend() {
    if (!email) return;
    setSending(true);
    try {
      await authClient.sendVerificationEmail({ email, callbackURL: "/tenant" });
      toast.success("Verification email sent", { description: `We re-sent the link to ${email}.` });
    } catch {
      toast.error("Couldn't resend", { description: "Please try again in a moment." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-svh flex-col px-6 py-8 sm:px-12">
      <div className="flex items-center justify-between">
        <DittoWordmark />
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-sm space-y-6 py-10 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MailCheck className="size-6" />
          </span>
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-bold tracking-tight">Check your email</h1>
            <p className="text-sm text-muted-foreground">
              {email ? <>We sent a verification link to <span className="font-medium text-foreground">{email}</span>.</> : "We sent you a verification link."}{" "}
              Click it to finish setting up your workspace.
            </p>
          </div>
          <Button onClick={resend} variant="outline" className="w-full" disabled={sending || !email}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : "Resend email"}
          </Button>
          <p className="text-sm text-muted-foreground">
            Already verified?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

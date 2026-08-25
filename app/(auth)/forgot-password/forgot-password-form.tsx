"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth-shell";
import { authClient } from "@/lib/auth-client";

const PANEL = {
  panelTitle: "Locked out? Back in a minute.",
  panelCopy:
    "We'll email you a one-time link to choose a new password. Your stores, screens, and content stay exactly where you left them.",
  panelStats: [
    { k: "1 min", v: "to get back in" },
    { k: "1 hr", v: "link validity" },
    { k: "1", v: "email, that's it" },
  ],
};

export function ForgotPasswordForm() {
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // Better Auth answers 200 with the same body whether or not the address has
    // an account, so nothing here can leak account existence — an `error` only
    // ever means a transport/config failure, which is worth surfacing.
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    setLoading(false);

    if (error) {
      toast.error("Couldn't send the reset link", {
        description: error.message ?? "Please try again in a moment.",
      });
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell {...PANEL}>
        <div className="space-y-6 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MailCheck className="size-6" />
          </span>
          <div className="space-y-2">
            <h1 className="font-display text-3xl font-bold tracking-tight">
              Check your email
            </h1>
            <p className="text-sm text-muted-foreground">
              If that email has an account, we&apos;ve sent a reset link to{" "}
              <span className="font-medium text-foreground">{email}</span>. The
              link works once and expires in an hour.
            </p>
          </div>
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setSent(false)}
            >
              Use a different email
            </Button>
            <Button variant="ghost" className="w-full" asChild>
              <Link href="/login">
                <ArrowLeft className="size-4" />
                Back to sign in
              </Link>
            </Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell {...PANEL}>
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Forgot your password?
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter the email you sign in with and we&apos;ll send you a link to set
          a new password.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@store.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              Send reset link
              <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

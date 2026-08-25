"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth-shell";
import { registerCompany } from "@/lib/actions/register";

export function SignupForm() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [matchError, setMatchError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setMatchError(null);
    if (fd.get("password") !== fd.get("confirmPassword")) {
      setMatchError("Passwords don't match.");
      return;
    }
    setLoading(true);
    const res = await registerCompany(fd);
    setLoading(false);

    if (!res.ok) {
      toast.error("Couldn't create your account", { description: res.error });
      return;
    }
    if (res.pendingVerification) {
      router.push(`/verify-email?email=${encodeURIComponent(res.email ?? "")}`);
      return;
    }
    toast.success("Welcome to Maratus", {
      description: "Your workspace is ready.",
    });
    router.push("/tenant");
    router.refresh();
  }

  return (
    <AuthShell
      panelTitle="Every screen, one trigger away."
      panelCopy="Set up your stores, pair your screens, and start showing content your customers can scan on the spot."
      panelStats={[
        { k: "1 min", v: "to set up" },
        { k: "0", v: "paper printed" },
        { k: "∞", v: "things to show" },
      ]}
    >
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Create your workspace
        </h1>
        <p className="text-sm text-muted-foreground">
          Start going paperless — set up your company in under a minute.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="companyName">Company name</Label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="companyName"
              name="companyName"
              placeholder="Roastwell Coffee"
              className="pl-9"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Your name</Label>
          <Input
            id="name"
            name="name"
            placeholder="Dana Okafor"
            autoComplete="name"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            placeholder="Repeat your password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          {matchError && <p className="text-sm text-destructive">{matchError}</p>}
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              Create workspace
              <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

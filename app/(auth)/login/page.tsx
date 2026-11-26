"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth-shell";
import { authClient } from "@/lib/auth-client";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { isDocsHost } from "@/lib/docs-host";

export default function LoginPage() {
  return (
    <React.Suspense>
      <LoginForm />
    </React.Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await authClient.signIn.email({ email, password });
    setLoading(false);

    if (error || !data) {
      toast.error("Sign in failed", {
        description: error?.message ?? "Invalid email or password.",
      });
      return;
    }

    // Route to the right panel: platform staff → /admin, everyone else → /tenant.
    // Exception: a sign-in started from the API docs returns there for anyone
    // (on docs.maratus.co the docs live at "/", locally at /docs).
    const role = (data.user as { role?: string }).role;
    const redirect = safeRedirectPath(params.get("redirect"), "");
    const dest = isDocsHost(window.location.host)
      ? "/"
      : redirect.startsWith("/docs")
        ? redirect
        : role === "platform_admin"
          ? "/admin"
          : redirect || "/tenant";
    router.push(dest);
    router.refresh();
  }

  return (
    <AuthShell
      panelTitle="Show anything with a single scan."
      panelCopy="Trigger a Maratus screen from your systems and a QR appears. Customers scan, view, and walk away — no paper, no reprints."
      panelLine="A better “here you go” at every till"
    >
      <div className="space-y-2">
        <h1 className="font-display text-[32px] leading-9 font-semibold tracking-[-0.022em]">
          Welcome back
        </h1>
        <p className="text-sm text-muted-foreground">
          Sign in to manage your screens, stores, and triggered content.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-[13px]">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="you@store.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="h-10 px-3"
            required
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-[13px]">
              Password
            </Label>
            <Link
              href="/forgot-password"
              className="text-[13px] text-foreground underline decoration-input underline-offset-[3px] transition-colors duration-[120ms] hover:decoration-current"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="h-10 px-3"
            required
          />
        </div>
        <Button type="submit" className="h-10 w-full" disabled={loading}>
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              Sign in
              <ArrowRight className="size-4 stroke-[1.6]" />
            </>
          )}
        </Button>
      </form>

      <p className="text-center text-[13px] text-pretty text-muted-foreground">
        Maratus accounts are invite-only — ask your workspace admin to
        send you an invitation.
      </p>
    </AuthShell>
  );
}

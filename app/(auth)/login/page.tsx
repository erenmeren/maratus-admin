"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Leaf, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaratusWordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { authClient } from "@/lib/auth-client";

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
    const role = (data.user as { role?: string }).role;
    const redirect = params.get("redirect");
    const dest =
      role === "platform_admin" ? "/admin" : redirect ?? "/tenant";
    router.push(dest);
    router.refresh();
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Form side */}
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <MaratusWordmark />
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm space-y-8 py-10">
            <div className="space-y-2">
              <h1 className="font-display text-3xl font-bold tracking-tight">
                Welcome back
              </h1>
              <p className="text-sm text-muted-foreground">
                Sign in to manage your screens, stores, and triggered content.
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
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="/forgot-password"
                    className="text-xs font-medium text-primary hover:underline"
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
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              Maratus accounts are invite-only — ask your workspace admin to
              send you an invitation.
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          © 2026 Maratus · Any content, one scan away.
        </p>
      </div>

      {/* Brand side */}
      <div className="relative hidden overflow-hidden bg-primary lg:block">
        <div className="absolute inset-0 bg-grid text-primary-foreground/10" />
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-primary-foreground/10 blur-2xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-primary-foreground/10 blur-2xl" />

        <div className="relative flex h-full flex-col justify-between p-12 text-primary-foreground">
          <div className="inline-flex items-center gap-2 self-start rounded-full bg-primary-foreground/15 px-3 py-1 text-xs font-medium backdrop-blur">
            <Leaf className="size-3.5" />
            Paperless by default
          </div>

          <div className="space-y-6">
            <h2 className="font-display text-4xl font-bold leading-tight tracking-tight">
              Show anything with a single scan.
            </h2>
            <p className="max-w-md text-primary-foreground/80">
              Trigger a Maratus screen from your systems and a QR appears. Customers
              scan, view, and walk away — no paper, no reprints.
            </p>
            <div className="grid grid-cols-3 gap-4 pt-2">
              {[
                { k: "1.2M", v: "activations delivered" },
                { k: "4.5M", v: "customer scans" },
                { k: "240+", v: "screens online" },
              ].map((s) => (
                <div key={s.v}>
                  <p className="font-display text-2xl font-bold">{s.k}</p>
                  <p className="text-xs text-primary-foreground/70">{s.v}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm text-primary-foreground/70">
            <QrCode className="size-5" />
            Scan once. Saved forever.
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Leaf, QrCode, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { DittoWordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

export default function LoginPage() {
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // No real auth — UI-only. Route into the tenant workspace.
    router.push("/tenant");
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Form side */}
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <DittoWordmark />
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm space-y-8 py-10">
            <div className="space-y-2">
              <h1 className="font-display text-3xl font-bold tracking-tight">
                Welcome back
              </h1>
              <p className="text-sm text-muted-foreground">
                Sign in to manage your kiosks, stores, and paperless receipts.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@store.com"
                  defaultValue="dana@roastwell.co"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="#"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  defaultValue="password"
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full">
                Sign in
                <ArrowRight className="size-4" />
              </Button>
            </form>

            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>

            <Button variant="outline" className="w-full" asChild>
              <Link href="/tenant">
                <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                  <path
                    fill="currentColor"
                    d="M21.35 11.1H12v3.83h5.35c-.23 1.4-1.62 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.95S8.78 7.13 12 7.13c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.74 4.6 14.6 3.6 12 3.6 6.95 3.6 2.85 7.7 2.85 12.75S6.95 21.9 12 21.9c5.27 0 8.76-3.7 8.76-8.92 0-.6-.06-1.05-.16-1.5z"
                  />
                </svg>
                Continue with SSO
              </Link>
            </Button>

            <Separator />

            {/* Prototype: clear entry points to both panels */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Prototype shortcuts
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/tenant">
                    <QrCode className="size-4" /> Tenant
                  </Link>
                </Button>
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/admin">
                    <Shield className="size-4" /> Super Admin
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          © 2026 Ditto · Digital receipts for a paperless checkout.
        </p>
      </div>

      {/* Brand / eco side */}
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
              Replace the paper receipt with a single scan.
            </h2>
            <p className="max-w-md text-primary-foreground/80">
              Ditto kiosks turn every checkout into a QR code. Customers scan,
              download, and walk away — no thermal paper, no waste.
            </p>
            <div className="grid grid-cols-3 gap-4 pt-2">
              {[
                { k: "1.2M", v: "receipts digitized" },
                { k: "3.8t", v: "paper saved" },
                { k: "240+", v: "kiosks online" },
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

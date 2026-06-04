"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Leaf, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DittoWordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { registerCompany } from "@/lib/actions/register";

export function SignupForm() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
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
    toast.success("Welcome to Ditto", {
      description: "Your workspace is ready.",
    });
    router.push("/tenant");
    router.refresh();
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
              Every checkout, one scan away from paperless.
            </h2>
            <p className="max-w-md text-primary-foreground/80">
              Set up your stores, pair your kiosks, and start issuing digital
              receipts your customers can scan and keep.
            </p>
            <div className="grid grid-cols-3 gap-4 pt-2">
              {[
                { k: "1 min", v: "to set up" },
                { k: "0", v: "paper receipts" },
                { k: "∞", v: "receipts stored" },
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

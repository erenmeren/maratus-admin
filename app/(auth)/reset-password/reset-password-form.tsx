"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth-shell";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({
  token,
  panel,
}: {
  token: string;
  panel: {
    panelTitle: string;
    panelCopy: string;
    panelStats: { k: string; v: string }[];
  };
}) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [matchError, setMatchError] = React.useState<string | null>(null);
  const [expired, setExpired] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMatchError(null);
    if (password !== confirmPassword) {
      setMatchError("Passwords don't match.");
      return;
    }
    setLoading(true);
    const { error } = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setLoading(false);

    if (error) {
      // The token can expire or be spent between page load and submit.
      if (error.code === "INVALID_TOKEN") {
        setExpired(true);
        return;
      }
      toast.error("Couldn't reset your password", {
        description: error.message ?? "Please try again in a moment.",
      });
      return;
    }

    toast.success("Password updated", {
      description: "Sign in with your new password.",
    });
    router.push("/login");
  }

  if (expired) {
    return (
      <AuthShell {...panel}>
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold tracking-tight">
            This reset link expired
          </h1>
          <p className="text-sm text-muted-foreground">
            Reset links are good for one hour and one use. Request a fresh one
            and we&apos;ll email it right away.
          </p>
        </div>
        <div className="space-y-3">
          <Button className="w-full" asChild>
            <Link href="/forgot-password">
              Request a new link
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button variant="ghost" className="w-full" asChild>
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell {...panel}>
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Set a new password
        </h1>
        <p className="text-sm text-muted-foreground">
          Choose a new password for your Maratus account. You&apos;ll sign in
          with it right after.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder="Repeat your new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
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
              Update password
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

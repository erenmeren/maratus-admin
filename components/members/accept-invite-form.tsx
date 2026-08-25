"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Mail, UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth-shell";
import { acceptInvitationAction, acceptInviteSignup } from "@/lib/actions/members";

const INVITE_PANEL = {
  panelTitle: "Your team is already here.",
  panelCopy:
    "Accept your invitation and start managing stores, screens, and triggered content together.",
  panelStats: [
    { k: "1 min", v: "to join" },
    { k: "0", v: "paper printed" },
    { k: "∞", v: "things to show" },
  ],
};

export function AcceptInviteForm({
  invitationId,
  email,
  orgName,
  mode,
  currentEmail,
}: {
  invitationId: string;
  email: string;
  orgName: string;
  mode: "accept" | "wrong-user" | "needs-signin" | "signup";
  currentEmail: string | null;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function go(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
      else window.location.href = "/tenant";
    });
  }

  return (
    <AuthShell {...INVITE_PANEL}>
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Join {orgName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {mode === "wrong-user" ? (
            <>This invitation was sent to a different account.</>
          ) : mode === "needs-signin" ? (
            <>
              You already have a Maratus account with this email. Sign in and
              reopen this link to join {orgName}.
            </>
          ) : mode === "accept" ? (
            <>
              You&apos;ve been invited to join {orgName} on Maratus. Accept the
              invitation to get started with your team.
            </>
          ) : (
            <>
              You&apos;ve been invited to join {orgName} on Maratus. Create your
              account to get started.
            </>
          )}
        </p>
      </div>

      {mode === "wrong-user" ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This invitation is for{" "}
            <span className="font-medium text-foreground">{email}</span>, but
            you&apos;re signed in as{" "}
            <span className="font-medium text-foreground">{currentEmail}</span>.
            Sign out, then reopen the invitation link to accept it.
          </p>
          <Button variant="outline" className="w-full" asChild>
            <Link href="/login">
              Go to sign in
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      ) : mode === "needs-signin" ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Invited email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="invite-email" value={email} className="pl-9" disabled readOnly />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Signing up again isn&apos;t possible with an email that already has
            an account. Sign in first, then open the invitation link again — it
            stays valid until you accept it.
          </p>
          <Button className="w-full" asChild>
            <Link href="/login">
              Go to sign in
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      ) : mode === "accept" ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Signed in as</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="invite-email" value={email} className="pl-9" disabled readOnly />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            className="w-full"
            disabled={pending}
            onClick={() => go(() => acceptInvitationAction(invitationId))}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <UserRoundPlus className="size-4" />
                Accept invitation
              </>
            )}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setMatchError(null);
            if (password !== confirmPassword) {
              setMatchError("Passwords don't match.");
              return;
            }
            go(() => acceptInviteSignup({ invitationId, name, password }));
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="invite-email">Invited email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="invite-email" value={email} className="pl-9" disabled readOnly />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-name">Your name</Label>
            <Input
              id="invite-name"
              placeholder="Dana Okafor"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-password">Password</Label>
            <Input
              id="invite-password"
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
            <Label htmlFor="invite-confirm-password">Confirm password</Label>
            <Input
              id="invite-confirm-password"
              type="password"
              placeholder="Repeat your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
            {matchError && <p className="text-sm text-destructive">{matchError}</p>}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                Create account &amp; join
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

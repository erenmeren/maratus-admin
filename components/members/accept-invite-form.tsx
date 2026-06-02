"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { acceptInvitationAction, acceptInviteSignup } from "@/lib/actions/members";

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
  mode: "accept" | "wrong-user" | "signup";
  currentEmail: string | null;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    <div className="mx-auto flex max-w-sm flex-col gap-4 p-8">
      <h1 className="text-xl font-semibold">Join {orgName}</h1>
      {mode === "wrong-user" ? (
        <p className="text-sm text-muted-foreground">
          You’re signed in as {currentEmail}, but this invitation is for {email}. Sign out and reopen the link to accept.
        </p>
      ) : mode === "accept" ? (
        <>
          <p className="text-sm text-muted-foreground">Accept the invitation to join {orgName} as a teammate.</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button disabled={pending} onClick={() => go(() => acceptInvitationAction(invitationId))}>
            Accept invitation
          </Button>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            go(() => acceptInviteSignup({ invitationId, name, password }));
          }}
        >
          <Input value={email} disabled readOnly />
          <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input type="password" placeholder="Password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>Create account &amp; join</Button>
        </form>
      )}
    </div>
  );
}

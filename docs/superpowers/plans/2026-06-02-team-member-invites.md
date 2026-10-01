# Team Member Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let owners/admins invite teammates (admin/member) to their org, manage roles/removal, and let invitees join the inviting org via `/signup?invite=<id>` — with member-event auditing.

**Architecture:** `auth.api.createInvitation` drives invite creation + the plugin's `sendInvitationEmail`; all other member mutations are direct Drizzle writes guarded by an explicit `canManageMembers` check (mirrors `lib/actions/register.ts`'s direct member inserts — avoids fragile `auth.api` body-shape assumptions and post-signup session threading). Pure authz/validation helpers are TDD'd.

**Tech Stack:** Next.js 16 App Router, Better Auth org plugin, Drizzle/Neon, vitest.

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `lib/members.ts` | pure `canManageMembers`, `inviteRoleIsValid` | Create |
| `lib/members.test.ts` | tests for the pure helpers | Create |
| `lib/auth.ts` | `sendInvitationEmail` on the org plugin | Modify |
| `lib/audit.ts` | + member/invitation action constants | Modify |
| `lib/actions/members.ts` | invite/cancel/remove/role + accept server actions | Create |
| `lib/data.ts` | `getOrgMembers`, `getOrgInvitations` | Modify |
| `app/(tenant)/tenant/members/page.tsx` | Members page | Create |
| `components/members/members-manager.tsx` | client invite form + row actions | Create |
| `app/(auth)/signup/page.tsx` | invite-token branch | Modify |
| `lib/nav.ts` | + Members in `TENANT_NAV` | Modify |

---

## Task 1: Pure helpers (TDD)

**Files:** Create `lib/members.ts`, `lib/members.test.ts`.

- [ ] **Step 1: Write failing test** `lib/members.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canManageMembers, inviteRoleIsValid } from "./members";

describe("canManageMembers", () => {
  it("allows owner and admin", () => {
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("admin")).toBe(true);
  });
  it("denies member and unknown/undefined", () => {
    expect(canManageMembers("member")).toBe(false);
    expect(canManageMembers(undefined)).toBe(false);
    expect(canManageMembers("guest")).toBe(false);
  });
});

describe("inviteRoleIsValid", () => {
  it("accepts admin/member only", () => {
    expect(inviteRoleIsValid("admin")).toBe(true);
    expect(inviteRoleIsValid("member")).toBe(true);
  });
  it("rejects owner and anything else", () => {
    expect(inviteRoleIsValid("owner")).toBe(false);
    expect(inviteRoleIsValid("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -- lib/members.test.ts`

- [ ] **Step 3: Implement `lib/members.ts`:**

```ts
// lib/members.ts
// Pure helpers for team-member management (no IO).

export type InviteRole = "admin" | "member";

/** Owners and admins may manage members. */
export function canManageMembers(role: string | undefined | null): boolean {
  return role === "owner" || role === "admin";
}

/** Invites may only grant admin or member (never owner). */
export function inviteRoleIsValid(role: string): role is InviteRole {
  return role === "admin" || role === "member";
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm test -- lib/members.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/members.ts lib/members.test.ts
git commit -m "feat: add pure member-management helpers"
```

---

## Task 2: Invite email wiring + audit constants

**Files:** Modify `lib/auth.ts`, `lib/audit.ts`.

- [ ] **Step 1: Add member audit constants** to the `AUDIT` object in `lib/audit.ts` (after `brandingUpdated`):

```ts
  memberInvited: "member.invited",
  memberAdded: "member.added",
  memberRemoved: "member.removed",
  memberRoleChanged: "member.role_changed",
  invitationCanceled: "invitation.canceled",
```

- [ ] **Step 2: Wire `sendInvitationEmail`** in `lib/auth.ts`. Add the email import at top (`import { sendEmail } from "./email";` — already present from Phase 0; verify and don't duplicate). Replace `organization(),` in the `plugins` array with:

```ts
    organization({
      async sendInvitationEmail(data) {
        const url = `${env.BETTER_AUTH_URL}/signup?invite=${data.id}`;
        await sendEmail(
          data.email,
          `You're invited to ${data.organization.name} on Maratus`,
          `<p>${data.inviter.user.name} invited you to join ` +
            `<b>${data.organization.name}</b> on Maratus.</p>` +
            `<p><a href="${url}">Accept the invitation</a></p>`,
        );
      },
    }),
```

(`env` is the `getEnv()` result already in scope in `lib/auth.ts`.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean. If `data.inviter`/`data.organization` field names differ in the installed better-auth types, adjust to the type (the param is fully typed — hover/read `node_modules/better-auth` types); report any change.

- [ ] **Step 4: Commit**

```bash
git add lib/auth.ts lib/audit.ts
git commit -m "feat: send invitation emails; add member audit actions"
```

---

## Task 3: Member server actions

**Files:** Create `lib/actions/members.ts`.

Context: `requireTenant()` returns `{ ctx, organizationId }`; `ctx.user = { id, name, email, role }`; `ctx.organizations` is an array of `{ id, role, ... }`. The `member` table = `{ id, organizationId, userId, role, createdAt }`; `invitation` = `{ id, organizationId, email, role, status, expiresAt, inviterId }`.

- [ ] **Step 1: Write the module**

```ts
// lib/actions/members.ts
"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { member, invitation } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { canManageMembers, inviteRoleIsValid, type InviteRole } from "@/lib/members";
import { recordAudit, AUDIT } from "@/lib/audit";

type Result = { ok: true } | { ok: false; error: string };

function actingRole(ctx: { organizations: { id: string; role: string }[] }, orgId: string) {
  return ctx.organizations.find((o) => o.id === orgId)?.role;
}

const actor = (ctx: { user: { id: string; email: string } }) =>
  ({ type: "user", id: ctx.user.id, label: ctx.user.email }) as const;

/** Invite a teammate (admin/member). Uses the plugin so sendInvitationEmail fires. */
export async function inviteMember(email: string, role: string): Promise<Result> {
  const { ctx, organizationId } = await requireTenant();
  if (!canManageMembers(actingRole(ctx, organizationId))) return { ok: false, error: "Not allowed." };
  if (!inviteRoleIsValid(role)) return { ok: false, error: "Invalid role." };
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, error: "Enter a valid email." };

  try {
    await auth.api.createInvitation({
      body: { email: clean, role: role as InviteRole, organizationId },
      headers: await headers(),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not invite." };
  }
  await recordAudit({ organizationId, actor: actor(ctx), action: AUDIT.memberInvited, metadata: { email: clean, role } });
  revalidatePath("/tenant/members");
  return { ok: true };
}

/** Cancel a pending invitation (direct write, scoped to the org). */
export async function cancelInvitation(invitationId: string): Promise<Result> {
  const { ctx, organizationId } = await requireTenant();
  if (!canManageMembers(actingRole(ctx, organizationId))) return { ok: false, error: "Not allowed." };
  await db
    .update(invitation)
    .set({ status: "canceled" })
    .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, organizationId)));
  await recordAudit({ organizationId, actor: actor(ctx), action: AUDIT.invitationCanceled, target: { type: "invitation", id: invitationId } });
  revalidatePath("/tenant/members");
  return { ok: true };
}

/** Remove a member (cannot remove an owner). */
export async function removeMember(memberId: string): Promise<Result> {
  const { ctx, organizationId } = await requireTenant();
  if (!canManageMembers(actingRole(ctx, organizationId))) return { ok: false, error: "Not allowed." };
  const [m] = await db
    .select()
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
    .limit(1);
  if (!m) return { ok: false, error: "Member not found." };
  if (m.role === "owner") return { ok: false, error: "Cannot remove the owner." };
  await db.delete(member).where(eq(member.id, memberId));
  await recordAudit({ organizationId, actor: actor(ctx), action: AUDIT.memberRemoved, target: { type: "member", id: memberId }, metadata: { userId: m.userId } });
  revalidatePath("/tenant/members");
  return { ok: true };
}

/** Change a member's role (admin/member only; never touch an owner). */
export async function updateMemberRole(memberId: string, role: string): Promise<Result> {
  const { ctx, organizationId } = await requireTenant();
  if (!canManageMembers(actingRole(ctx, organizationId))) return { ok: false, error: "Not allowed." };
  if (!inviteRoleIsValid(role)) return { ok: false, error: "Invalid role." };
  const [m] = await db
    .select()
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
    .limit(1);
  if (!m) return { ok: false, error: "Member not found." };
  if (m.role === "owner") return { ok: false, error: "Cannot change the owner's role." };
  await db.update(member).set({ role }).where(eq(member.id, memberId));
  await recordAudit({ organizationId, actor: actor(ctx), action: AUDIT.memberRoleChanged, target: { type: "member", id: memberId }, metadata: { to: role } });
  revalidatePath("/tenant/members");
  return { ok: true };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; tests pass. If `auth.api.createInvitation`'s body shape differs (e.g. wants `resend` or different key names), tsc will flag it — adjust to the typed signature and report the change.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/members.ts
git commit -m "feat: member management server actions (invite/cancel/remove/role)"
```

---

## Task 4: Data fns — members + pending invitations

**Files:** Modify `lib/data.ts`.

- [ ] **Step 1: Append** to `lib/data.ts` (use the file's existing `db`/`eq`/table-alias import style; you need `member`, `user`, `invitation` tables and `eq`/`and`):

```ts
export async function getOrgMembers(organizationId: string) {
  const { member, user } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select({
      id: member.id,
      userId: member.userId,
      role: member.role,
      name: user.name,
      email: user.email,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, organizationId));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    role: r.role,
    name: r.name,
    email: r.email,
    joinedAt: r.joinedAt.toISOString(),
  }));
}

export async function getOrgInvitations(organizationId: string) {
  const { invitation } = await import("@/lib/db/schema");
  const { eq, and } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(invitation)
    .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, "pending")));
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role ?? "member",
    expiresAt: r.expiresAt.toISOString(),
  }));
}
```

> If `lib/data.ts` already imports `member`/`user`/`invitation`/`eq`/`and` at the top, use those directly instead of the inline `await import(...)` (match the file's convention — check first).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/data.ts
git commit -m "feat: data fns for org members and pending invitations"
```

---

## Task 5: Members page + client manager + nav

**Files:** Create `app/(tenant)/tenant/members/page.tsx`, `components/members/members-manager.tsx`; Modify `lib/nav.ts`.

- [ ] **Step 1: Client manager** `components/members/members-manager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  inviteMember,
  cancelInvitation,
  removeMember,
  updateMemberRole,
} from "@/lib/actions/members";

type Member = { id: string; name: string; email: string; role: string };
type Invite = { id: string; email: string; role: string };

export function MembersManager({
  members,
  invitations,
  canManage,
}: {
  members: Member[];
  invitations: Invite[];
  canManage: boolean;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => inviteMember(email, role).then((r) => (r.ok && setEmail(""), r)));
          }}
        >
          <div className="flex flex-col gap-1">
            <label className="text-sm text-muted-foreground">Email</label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" type="email" required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm text-muted-foreground">Role</label>
            <select className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <Button type="submit" disabled={pending}>Invite</Button>
        </form>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Members</h2>
        <table className="w-full text-sm">
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="py-2">{m.name}</td>
                <td className="text-muted-foreground">{m.email}</td>
                <td>{m.role}</td>
                <td className="text-right">
                  {canManage && m.role !== "owner" && (
                    <span className="flex justify-end gap-2">
                      <button className="underline" disabled={pending} onClick={() => run(() => updateMemberRole(m.id, m.role === "admin" ? "member" : "admin"))}>
                        Make {m.role === "admin" ? "member" : "admin"}
                      </button>
                      <button className="text-destructive underline" disabled={pending} onClick={() => run(() => removeMember(m.id))}>
                        Remove
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invitations.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Pending invitations</h2>
          <table className="w-full text-sm">
            <tbody>
              {invitations.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="py-2">{i.email}</td>
                  <td>{i.role}</td>
                  <td className="text-right">
                    {canManage && (
                      <button className="text-destructive underline" disabled={pending} onClick={() => run(() => cancelInvitation(i.id))}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Members page** `app/(tenant)/tenant/members/page.tsx`:

```tsx
import { requireTenant } from "@/lib/session";
import { getOrgMembers, getOrgInvitations } from "@/lib/data";
import { canManageMembers } from "@/lib/members";
import { MembersManager } from "@/components/members/members-manager";

export default async function MembersPage() {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  const [members, invitations] = await Promise.all([
    getOrgMembers(organizationId),
    getOrgInvitations(organizationId),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
      <MembersManager members={members} invitations={invitations} canManage={canManageMembers(role)} />
    </div>
  );
}
```

- [ ] **Step 3: Nav** — in `lib/nav.ts`, add `Users` to the lucide import (if not present) and add to `TENANT_NAV` (after Branding, before Reports is fine):

```ts
  { label: "Members", href: "/tenant/members", icon: Users },
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: clean; `/tenant/members` listed.

- [ ] **Step 5: Commit**

```bash
git add "app/(tenant)/tenant/members/" components/members/ lib/nav.ts
git commit -m "feat: members page with invite/manage UI"
```

---

## Task 6: Accept flow — invite-token signup

**Files:** Modify `app/(auth)/signup/page.tsx`; add server actions to `lib/actions/members.ts`.

First READ `app/(auth)/signup/page.tsx` and `lib/actions/register.ts` to match the existing form/handler conventions (the page is a client component using `registerCompany`).

- [ ] **Step 1: Add accept server actions** to `lib/actions/members.ts`:

```ts
import { user } from "@/lib/db/schema";
import { id as genId } from "@/lib/ids";

/** Load a pending invitation for the signup page (server-read). */
export async function getInvitationForSignup(invitationId: string) {
  const [inv] = await db
    .select({ id: invitation.id, email: invitation.email, role: invitation.role, status: invitation.status, organizationId: invitation.organizationId, expiresAt: invitation.expiresAt })
    .from(invitation)
    .where(eq(invitation.id, invitationId))
    .limit(1);
  if (!inv || inv.status !== "pending" || inv.expiresAt.getTime() < Date.now()) return null;
  const { organization } = await import("@/lib/db/schema");
  const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, inv.organizationId)).limit(1);
  return { id: inv.id, email: inv.email, role: inv.role ?? "member", orgName: org?.name ?? "the team" };
}

/** Accept as an already-signed-in user whose email matches the invite. */
export async function acceptInvitationAction(invitationId: string): Promise<Result> {
  const { ctx } = await requireTenant().catch(() => ({ ctx: null }) as never);
  // requireTenant requires an active org; for accept we just need a session — use getContext instead:
  const { getContext } = await import("@/lib/session");
  const session = await getContext();
  if (!session) return { ok: false, error: "Sign in to accept." };
  const [inv] = await db.select().from(invitation).where(eq(invitation.id, invitationId)).limit(1);
  if (!inv || inv.status !== "pending" || inv.expiresAt.getTime() < Date.now()) return { ok: false, error: "Invitation is no longer valid." };
  if (inv.email.toLowerCase() !== session.user.email.toLowerCase()) return { ok: false, error: "This invitation is for a different email." };

  await db.insert(member).values({ id: genId("mem"), organizationId: inv.organizationId, userId: session.user.id, role: inv.role ?? "member", createdAt: new Date() });
  await db.update(invitation).set({ status: "accepted" }).where(eq(invitation.id, invitationId));
  await recordAudit({ organizationId: inv.organizationId, actor: { type: "user", id: session.user.id, label: session.user.email }, action: AUDIT.memberAdded, target: { type: "member", id: session.user.id } });
  return { ok: true };
}

/** Brand-new user accepts via signup: create verified user, join the inviting org. */
export async function acceptInviteSignup(input: { invitationId: string; name: string; password: string }): Promise<Result> {
  const [inv] = await db.select().from(invitation).where(eq(invitation.id, input.invitationId)).limit(1);
  if (!inv || inv.status !== "pending" || inv.expiresAt.getTime() < Date.now()) return { ok: false, error: "Invitation is no longer valid." };
  if (input.name.trim().length === 0) return { ok: false, error: "Your name is required." };
  if (input.password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

  try {
    await auth.api.signUpEmail({ body: { name: input.name.trim(), email: inv.email, password: input.password }, headers: await headers() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sign up failed.";
    return { ok: false, error: /exist|already|unique/i.test(msg) ? "An account with that email already exists — sign in to accept." : msg };
  }

  const [created] = await db.select({ id: user.id }).from(user).where(eq(user.email, inv.email)).limit(1);
  if (!created) return { ok: false, error: "Could not load the new account." };

  // The invitation proves inbox ownership → mark verified so the session is usable.
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, created.id));
  await db.insert(member).values({ id: genId("mem"), organizationId: inv.organizationId, userId: created.id, role: inv.role ?? "member", createdAt: new Date() });
  await db.update(invitation).set({ status: "accepted" }).where(eq(invitation.id, input.invitationId));
  await recordAudit({ organizationId: inv.organizationId, actor: { type: "user", id: created.id, label: inv.email }, action: AUDIT.memberAdded, target: { type: "member", id: created.id } });
  return { ok: true };
}
```

> Note: `acceptInvitationAction` uses `getContext()` (session-only) rather than `requireTenant()` (which needs an *active* org the user may not have yet). Remove the stray `requireTenant().catch(...)` line — it's shown only to flag the reasoning; the real implementation uses `getContext()` directly. The implementer must write it cleanly with just `getContext()`.

- [ ] **Step 2: Branch the signup page** `app/(auth)/signup/page.tsx`. It's a client component. Make it read `?invite=`. Because server-reads (`getInvitationForSignup`) are async, the cleanest structure: convert the page to a thin server component that reads `searchParams.invite`, loads the invitation + current session, and renders either the existing signup form (no invite) or an invite view. Concretely:
  - Create `app/(auth)/signup/signup-form.tsx` = the CURRENT client form (move existing JSX/handler there unchanged; it calls `registerCompany`).
  - Rewrite `page.tsx` as a server component:

```tsx
import { getContext } from "@/lib/session";
import { getInvitationForSignup } from "@/lib/actions/members";
import { SignupForm } from "./signup-form";
import { AcceptInviteForm } from "@/components/members/accept-invite-form";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  if (!invite) return <SignupForm />;

  const inv = await getInvitationForSignup(invite);
  if (!inv) {
    return <p className="p-8 text-center text-sm text-muted-foreground">This invitation is invalid or has expired.</p>;
  }
  const ctx = await getContext();
  const signedInMatch = ctx?.user.email.toLowerCase() === inv.email.toLowerCase();
  const signedInOther = ctx && !signedInMatch;

  return (
    <AcceptInviteForm
      invitationId={inv.id}
      email={inv.email}
      orgName={inv.orgName}
      mode={signedInMatch ? "accept" : signedInOther ? "wrong-user" : "signup"}
      currentEmail={ctx?.user.email ?? null}
    />
  );
}
```

- [ ] **Step 3: Create `components/members/accept-invite-form.tsx`** (client):

```tsx
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
          <Button type="submit" disabled={pending}>Create account & join</Button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: clean; 21 tests pass (19 + 4 new from Task 1... actual count is fine as long as green); `/signup` builds.

- [ ] **Step 5: Commit**

```bash
git add "app/(auth)/signup/" components/members/ lib/actions/members.ts
git commit -m "feat: invite-token signup + accept flow"
```

---

## Task 7: Manual verification (human-run)

- [ ] As `dana@roastwell.co` (owner), open `/tenant/members`, invite `teammate@example.com` as member. Confirm the invite link is logged (no Resend key) or emailed; a `member.invited` audit row appears.
- [ ] Open `/signup?invite=<id>` in a fresh browser/incognito → create account → land in `/tenant` as a member of Roastwell; `member.added` audit row appears; the new user appears in the members list.
- [ ] As owner: change the member to admin, then remove them — confirm `member.role_changed` + `member.removed` audit rows.
- [ ] Sign in as a `member`-role user → `/tenant/members` shows read-only lists (no invite form / row actions).

---

## Self-Review

- **Spec coverage:** invite email (T2), server actions invite/cancel/remove/role (T3), members page + read-only-for-members (T5), accept flow new+existing user (T6), audit (T2/T3/T6), pure helpers (T1). All spec sections mapped.
- **Placeholder scan:** no logic placeholders. T4/T6 carry "match the file's existing import style / read the file" adaptation notes (the code is fully specified). The `acceptInvitationAction` Step-1 note explicitly says to drop the stray `requireTenant().catch` line and use `getContext()` — flagged, not ambiguous.
- **Type consistency:** `canManageMembers`/`inviteRoleIsValid`/`InviteRole` (T1) used in T3/T5; `AUDIT.member*` (T2) used in T3/T6; `getOrgMembers`/`getOrgInvitations` (T4) consumed by the page (T5); `getInvitationForSignup`/`acceptInvitationAction`/`acceptInviteSignup` (T6) consumed by the signup page + accept form.

## Execution notes

- **Runs green now:** Task 1 (pure). All other tasks compile without external services; invite email no-ops to console without `RESEND_API_KEY`.
- **No migration** — `member`/`invitation` tables already exist.
- `auth.api.createInvitation` body shape is the one version-specific call — tsc will surface any mismatch; adjust to the typed signature.

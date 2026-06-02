// lib/actions/members.ts
"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { member, invitation, user } from "@/lib/db/schema";
import { requireTenant, getContext } from "@/lib/session";
import { canManageMembers, inviteRoleIsValid, type InviteRole } from "@/lib/members";
import { recordAudit, AUDIT } from "@/lib/audit";
import { id as genId } from "@/lib/ids";

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

/** Load a pending invitation for the signup page (server-read). Returns null if invalid/expired/used. */
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
  const session = await getContext();
  if (!session) return { ok: false, error: "Sign in to accept." };
  const [inv] = await db.select().from(invitation).where(eq(invitation.id, invitationId)).limit(1);
  if (!inv || inv.status !== "pending" || inv.expiresAt.getTime() < Date.now()) return { ok: false, error: "Invitation is no longer valid." };
  if (inv.email.toLowerCase() !== session.user.email.toLowerCase()) return { ok: false, error: "This invitation is for a different email." };

  await db
    .insert(member)
    .values({ id: genId("mem"), organizationId: inv.organizationId, userId: session.user.id, role: inv.role ?? "member", createdAt: new Date() })
    .onConflictDoNothing();
  await db.update(invitation).set({ status: "accepted" }).where(eq(invitation.id, invitationId));
  await recordAudit({ organizationId: inv.organizationId, actor: { type: "user", id: session.user.id, label: session.user.email }, action: AUDIT.memberAdded, target: { type: "member", id: session.user.id } });
  return { ok: true };
}

/** Brand-new user accepts via signup: create a verified user, join the inviting org. */
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

  // The invitation proves inbox ownership → verify, then sign in so the user
  // lands in the app with a real session (signUpEmail issues none while
  // requireEmailVerification is on).
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, created.id));
  try {
    await auth.api.signInEmail({ body: { email: inv.email, password: input.password }, headers: await headers() });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not sign in." };
  }
  await db
    .insert(member)
    .values({ id: genId("mem"), organizationId: inv.organizationId, userId: created.id, role: inv.role ?? "member", createdAt: new Date() })
    .onConflictDoNothing();
  await db.update(invitation).set({ status: "accepted" }).where(eq(invitation.id, input.invitationId));
  await recordAudit({ organizationId: inv.organizationId, actor: { type: "user", id: created.id, label: inv.email }, action: AUDIT.memberAdded, target: { type: "member", id: created.id } });
  return { ok: true };
}

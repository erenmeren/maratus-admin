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

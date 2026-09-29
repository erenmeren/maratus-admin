"use server";

// Customer (organization/tenant) mutations — platform-admin only.

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { eq, and, ne, count, gt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { organization, tenantSettings, member, user, invitation } from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { id } from "@/lib/ids";
import { recordAudit, AUDIT } from "@/lib/audit";
import { isOrgArchived } from "@/lib/archived-guard";
import { getEnv } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/billing/invoice-emails";
import { platformCanManage, shouldDeleteOrphanedUser } from "@/lib/members";

export interface CreateCustomerResult {
  ok: boolean;
  error?: string;
  organizationId?: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

export async function createCustomer(
  formData: FormData,
): Promise<CreateCustomerResult> {
  const ctx = await requirePlatformAdmin();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Company name is required." };

  // Unique slug (append a short suffix if taken).
  let slug = slugify(name) || "customer";
  const existing = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);
  if (existing.length > 0) slug = `${slug}-${id("x").slice(2, 6).toLowerCase()}`;

  const orgId = id("org");
  await db.insert(organization).values({
    id: orgId,
    name,
    slug,
    createdAt: new Date(),
  });

  await db.insert(tenantSettings).values({
    organizationId: orgId,
    status: "active",
  });

  await recordAudit({
    organizationId: orgId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.customerCreated,
    metadata: { name },
  });

  revalidatePath("/admin/customers");
  revalidatePath("/admin");
  revalidatePath("/admin/billing");
  return { ok: true, organizationId: orgId };
}

/**
 * Rename a customer (organization display name). The slug is deliberately left
 * alone — it's the org's stable identifier for Better Auth lookups, and a
 * typo-fix on the display name shouldn't invalidate it.
 */
export async function renameCustomerAction(
  organizationId: string,
  rawName: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePlatformAdmin();

  const name = rawName.trim();
  if (!name) return { ok: false, error: "Company name is required." };
  if (name.length > 120) return { ok: false, error: "That name is too long." };

  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  if (!org) return { ok: false, error: "Customer not found." };
  if (await isOrgArchived(organizationId)) {
    return { ok: false, error: "Customer is archived." };
  }
  if (org.name === name) return { ok: true };

  await db
    .update(organization)
    .set({ name })
    .where(eq(organization.id, organizationId));

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.customerRenamed,
    metadata: { from: org.name, to: name },
  });

  revalidatePath(`/admin/customers/${organizationId}`);
  revalidatePath("/admin/customers");
  revalidatePath("/admin");
  return { ok: true };
}

export type InviteOwnerState = {
  ok: boolean;
  error?: string;
  /** Accept URL — always returned on success so the admin can hand it over even when email delivery is down. */
  url?: string;
  /** Whether the invitation email actually went out. */
  emailed?: boolean;
};

/**
 * Invite the first user (owner) into an admin-created org. Better Auth's
 * createInvitation API requires an org-member session, which the platform
 * admin never has — so this inserts the invitation row directly, mirroring
 * the shape sendInvitationEmail/acceptInviteSignup expect.
 */
export async function inviteOwnerAction(
  _prev: InviteOwnerState,
  formData: FormData,
): Promise<InviteOwnerState> {
  const ctx = await requirePlatformAdmin();
  const orgId = String(formData.get("organizationId") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!orgId) return { ok: false, error: "Missing organization." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email." };
  }
  if (await isOrgArchived(orgId)) {
    return { ok: false, error: "Customer is archived." };
  }

  const [existingMember] = await db
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), eq(user.email, email)))
    .limit(1);
  if (existingMember) {
    return { ok: false, error: "That email is already a member." };
  }

  const [openInvite] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, orgId),
        sql`lower(${invitation.email}) = ${email}`,
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (openInvite) {
    return { ok: false, error: "That email already has a pending invitation — cancel it first to send a new one." };
  }

  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  if (!org) return { ok: false, error: "Customer not found." };

  const invId = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(invitation).values({
    id: invId,
    organizationId: orgId,
    email,
    role: "owner",
    status: "pending",
    expiresAt,
    inviterId: ctx.user.id,
  });

  const url = `${getEnv().BETTER_AUTH_URL}/signup?invite=${invId}`;
  const emailed = await sendEmail(
    email,
    `You're invited to own ${org.name.replace(/[\r\n]/g, " ")} on Maratus`,
    `<p>The Maratus team invited you to own ` +
      `<b>${escapeHtml(org.name)}</b> on Maratus.</p>` +
      `<p><a href="${url}">Accept the invitation</a></p>`,
  );

  await recordAudit({
    organizationId: orgId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.memberInvited,
    metadata: { email, role: "owner", by: "platform_admin" },
  });

  revalidatePath(`/admin/customers/${orgId}`);
  return { ok: true, url, emailed };
}

type TeamResult = { ok: true; accountDeleted?: boolean } | { ok: false; error: string };

/**
 * Remove a member the platform admin invited. Customer-invited members are the
 * tenant's to manage and are refused here. If the person no longer belongs to
 * any org afterwards, their account is deleted too (sessions cascade), so the
 * email can be invited again from a clean slate.
 */
export async function removeCustomerMemberAction(
  organizationId: string,
  memberId: string,
): Promise<TeamResult> {
  const ctx = await requirePlatformAdmin();
  if (await isOrgArchived(organizationId)) return { ok: false, error: "Customer is archived." };

  const inviter = alias(user, "inviter");
  const [m] = await db
    .select({
      userId: member.userId,
      role: member.role,
      email: user.email,
      userRole: user.role,
      inviterRole: inviter.role,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(inviter, eq(inviter.id, member.invitedById))
    .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
    .limit(1);
  if (!m) return { ok: false, error: "Member not found." };
  if (!platformCanManage(m.inviterRole)) {
    return { ok: false, error: "This person was added by the customer — only they can remove them." };
  }

  const [{ n: otherMemberships }] = await db
    .select({ n: count() })
    .from(member)
    .where(and(eq(member.userId, m.userId), ne(member.organizationId, organizationId)));
  const accountDeleted = shouldDeleteOrphanedUser(m.userRole, otherMemberships);

  if (accountDeleted) {
    await db.delete(user).where(eq(user.id, m.userId));
  } else {
    await db.delete(member).where(eq(member.id, memberId));
  }

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.memberRemoved,
    target: { type: "member", id: memberId },
    metadata: { userId: m.userId, email: m.email, role: m.role, by: "platform_admin", accountDeleted },
  });

  revalidatePath(`/admin/customers/${organizationId}`);
  return { ok: true, accountDeleted };
}

/** Cancel a pending invitation the platform admin sent. Customer-sent invites are refused. */
export async function cancelCustomerInvitationAction(
  organizationId: string,
  invitationId: string,
): Promise<TeamResult> {
  const ctx = await requirePlatformAdmin();

  const inviter = alias(user, "inviter");
  const [inv] = await db
    .select({ email: invitation.email, status: invitation.status, inviterRole: inviter.role })
    .from(invitation)
    .innerJoin(inviter, eq(inviter.id, invitation.inviterId))
    .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, organizationId)))
    .limit(1);
  if (!inv || inv.status !== "pending") return { ok: false, error: "Invitation not found." };
  if (!platformCanManage(inv.inviterRole)) {
    return { ok: false, error: "This invitation was sent by the customer — only they can cancel it." };
  }

  await db.update(invitation).set({ status: "canceled" }).where(eq(invitation.id, invitationId));
  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.invitationCanceled,
    target: { type: "invitation", id: invitationId },
    metadata: { email: inv.email, by: "platform_admin" },
  });

  revalidatePath(`/admin/customers/${organizationId}`);
  return { ok: true };
}

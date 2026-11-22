// lib/members.ts
// Pure helpers for team-member management (no IO).

import { TENANT_ROLES, type TenantRole } from "./roles";

export type InviteRole = Exclude<TenantRole, "owner">;

/** Roles an invite (or a role change) may grant: every tenant role but owner. */
export const INVITE_ROLES: readonly InviteRole[] = TENANT_ROLES.filter(
  (r): r is InviteRole => r !== "owner",
);

export const ROLE_LABELS: Record<TenantRole, { label: string; description: string }> = {
  owner: { label: "Owner", description: "Full access, including members and billing. Cannot be removed." },
  admin: { label: "Admin", description: "Full access to every section, including members." },
  member: { label: "Member", description: "Can view every section but change nothing." },
  designer: { label: "Designer", description: "Edits branding and pinned QR codes." },
  operations: { label: "Operations", description: "Manages stores, devices and device settings." },
  billing: { label: "Billing", description: "Views subscription and invoices." },
  developer: { label: "Developer", description: "Manages API keys; views stores and devices." },
};

/** Owners and admins may manage members. */
export function canManageMembers(role: string | undefined | null): boolean {
  return role === "owner" || role === "admin";
}

/** Invites may grant any tenant role except owner. */
export function inviteRoleIsValid(role: string): role is InviteRole {
  return (INVITE_ROLES as readonly string[]).includes(role);
}

/** The admin console may remove a member / cancel an invitation only when a
 *  platform admin sent the invite. `inviterRole` is the inviter's `user.role`
 *  (null when provenance is unknown or the inviter is gone). */
export function platformCanManage(inviterRole: string | null | undefined): boolean {
  return inviterRole === "platform_admin";
}

/** After a platform-admin removal, drop the account too if it no longer
 *  belongs anywhere — otherwise a dead login lingers and blocks a clean
 *  re-invite. Never touches platform admins. */
export function shouldDeleteOrphanedUser(userRole: string, remainingMemberships: number): boolean {
  return userRole !== "platform_admin" && remainingMemberships === 0;
}

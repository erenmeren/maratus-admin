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

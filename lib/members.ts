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

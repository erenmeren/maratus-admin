// lib/roles.ts
// Pure tenant-role predicates (no IO). Tenant roles are owner/admin/member
// (Better Auth org plugin, stored on `member.role`); owners and admins may
// mutate the tenant's resources, members are read-only.

/** Owners and admins may manage tenant resources (devices, billing, etc.). */
export function canManageTenant(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

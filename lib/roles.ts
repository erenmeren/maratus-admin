// lib/roles.ts
// Pure tenant-role predicates (no IO). Tenant roles are owner/admin/member
// (Better Auth org plugin, stored on `member.role`); owners and admins may
// mutate the tenant's resources, members are read-only.

/** Owners and admins may manage tenant resources (devices, billing, etc.). */
export function canManageTenant(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export type Section =
  | "dashboard"
  | "stores"
  | "devices"
  | "deviceSettings"
  | "pinnedQr"
  | "branding"
  | "members"
  | "billing"
  | "api"
  | "activity";

export const TENANT_ROLES = [
  "owner",
  "admin",
  "member",
  "designer",
  "operations",
  "billing",
  "developer",
] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/** Same order as TENANT_NAV. */
export const SECTION_HREF: Record<Section, string> = {
  dashboard: "/tenant",
  stores: "/tenant/stores",
  devices: "/tenant/devices",
  deviceSettings: "/tenant/device-settings",
  pinnedQr: "/tenant/pinned-qr",
  branding: "/tenant/branding",
  members: "/tenant/members",
  billing: "/tenant/billing",
  api: "/tenant/api",
  activity: "/tenant/activity",
};

type Access = { view: Section[] | "all"; manage: Section[] | "all" };

const ACCESS: Record<TenantRole, Access> = {
  owner: { view: "all", manage: "all" },
  admin: { view: "all", manage: "all" },
  member: { view: "all", manage: [] },
  designer: { view: ["branding", "pinnedQr"], manage: ["branding", "pinnedQr"] },
  operations: {
    view: ["dashboard", "stores", "devices", "deviceSettings"],
    manage: ["stores", "devices", "deviceSettings"],
  },
  billing: { view: ["billing"], manage: [] },
  developer: { view: ["api", "stores", "devices"], manage: ["api"] },
};

function lookup(role: string | null | undefined): Access | undefined {
  return role && Object.hasOwn(ACCESS, role) ? ACCESS[role as TenantRole] : undefined;
}

export function canView(role: string | null | undefined, section: Section): boolean {
  const v = lookup(role)?.view;
  return v === "all" || !!v?.includes(section);
}

export function canManage(role: string | null | undefined, section: Section): boolean {
  const m = lookup(role)?.manage;
  return m === "all" || !!m?.includes(section);
}

/** First nav section the role may view, or null for an unknown role. */
export function firstViewableHref(role: string | null | undefined): string | null {
  const s = (Object.keys(SECTION_HREF) as Section[]).find((x) => canView(role, x));
  return s ? SECTION_HREF[s] : null;
}

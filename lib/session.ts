// Server-side session + tenant context helpers.
//
// Resolves the Better Auth session, the user's organizations, and the active
// organization (the tenant whose data the tenant panel shows). Use the
// `require*` helpers in server components / layouts to gate access.

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "./db";
import { member, organization, tenantSettings } from "./db/schema";
import { canManage, canView, firstViewableHref, type Section } from "./roles";

export interface OrgRef {
  id: string;
  name: string;
  slug: string | null;
  role: string;
}

export interface AppContext {
  user: { id: string; name: string; email: string; role: string };
  organizations: OrgRef[];
  activeOrganizationId: string | null;
}

/** Resolve the current session + org memberships, or null if signed out. */
export async function getContext(): Promise<AppContext | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const memberships = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
      archivedAt: tenantSettings.archivedAt,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .leftJoin(tenantSettings, eq(tenantSettings.organizationId, organization.id))
    .where(eq(member.userId, session.user.id));

  // Archived orgs never appear in the switcher and can never become active.
  const activeOrgs = memberships.filter((o) => o.archivedAt === null);
  const organizations: OrgRef[] = activeOrgs.map(({ id, name, slug, role }) => ({
    id,
    name,
    slug,
    role,
  }));

  const sessionActiveId = session.session.activeOrganizationId ?? null;
  const activeOrganizationId = activeOrgs.some((o) => o.id === sessionActiveId)
    ? sessionActiveId
    : (activeOrgs[0]?.id ?? null);

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      // `role` is a Better Auth additionalField on user.
      role: (session.user as { role?: string }).role ?? "user",
    },
    organizations,
    activeOrganizationId,
  };
}

/** Tenant-panel guard: requires a signed-in user with an active organization. */
export async function requireTenant(): Promise<{
  ctx: AppContext;
  organizationId: string;
}> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrganizationId) {
    redirect(ctx.user.role === "platform_admin" ? "/admin" : "/archived");
  }
  return { ctx, organizationId: ctx.activeOrganizationId };
}

/** Section guard: requireTenant + the active-org role must be able to view
 *  `section`; otherwise send the user to their first viewable section (404 for
 *  a role that can view nothing). */
export async function requireSection(section: Section): Promise<{
  ctx: AppContext;
  organizationId: string;
  role: string | undefined;
  canManage: boolean;
}> {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  if (!canView(role, section)) {
    const href = firstViewableHref(role);
    if (!href) notFound();
    redirect(href);
  }
  return { ctx, organizationId, role, canManage: canManage(role, section) };
}

/** Super-admin guard: requires a platform_admin user. */
export async function requirePlatformAdmin(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "platform_admin") redirect("/tenant");
  return ctx;
}

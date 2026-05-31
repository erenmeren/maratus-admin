// Server-side session + tenant context helpers.
//
// Resolves the Better Auth session, the user's organizations, and the active
// organization (the tenant whose data the tenant panel shows). Use the
// `require*` helpers in server components / layouts to gate access.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "./db";
import { member, organization } from "./db/schema";

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

  const organizations = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, session.user.id));

  const activeOrganizationId =
    session.session.activeOrganizationId ?? organizations[0]?.id ?? null;

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
    redirect(ctx.user.role === "platform_admin" ? "/admin" : "/login");
  }
  return { ctx, organizationId: ctx.activeOrganizationId };
}

/** Super-admin guard: requires a platform_admin user. */
export async function requirePlatformAdmin(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "platform_admin") redirect("/tenant");
  return ctx;
}

"use server";

// Self-serve company registration.
//
// Creates the owner user (and signs them in — nextCookies forwards the session
// cookie from this server action), then their organization + owner membership +
// tenant settings. After this resolves, the client redirects to /tenant.

import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { member, organization, tenantSettings, user } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { recordAudit, AUDIT } from "@/lib/audit";

export interface RegisterResult {
  ok: boolean;
  error?: string;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "company"
  );
}

export async function registerCompany(
  formData: FormData,
): Promise<RegisterResult> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const companyName = String(formData.get("companyName") ?? "").trim();

  if (!name) return { ok: false, error: "Your name is required." };
  if (!companyName) return { ok: false, error: "Company name is required." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  // 1. Create the user + session (cookie set via nextCookies in this action).
  try {
    await auth.api.signUpEmail({
      body: { name, email, password },
      headers: await headers(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sign up failed.";
    if (/exist|already|unique/i.test(msg)) {
      return { ok: false, error: "An account with that email already exists." };
    }
    return { ok: false, error: msg };
  }

  // Look up the freshly-created user.
  const [created] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (!created) return { ok: false, error: "Could not load the new account." };
  const userId = created.id;

  // 2. Create the organization with a unique slug.
  let slug = slugify(companyName);
  const slugTaken = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);
  if (slugTaken.length > 0) slug = `${slug}-${id("x").slice(2, 6).toLowerCase()}`;

  let orgId: string;
  try {
    const org = await auth.api.createOrganization({
      body: { name: companyName, slug, userId },
      headers: await headers(),
    });
    if (!org) throw new Error("Organization not created.");
    orgId = org.id;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not create company.",
    };
  }

  // 3. Ensure the owner membership exists (createOrganization usually adds it).
  const existingMember = await db
    .select({ id: member.id })
    .from(member)
    .where(eq(member.organizationId, orgId))
    .limit(1);
  if (existingMember.length === 0) {
    await db.insert(member).values({
      id: id("mem"),
      organizationId: orgId,
      userId,
      role: "owner",
      createdAt: new Date(),
    });
  }

  // 4. Seed tenant settings (default per-print price + brand).
  await db
    .insert(tenantSettings)
    .values({ organizationId: orgId, status: "active" })
    .onConflictDoNothing();

  await recordAudit({
    organizationId: orgId,
    actor: { type: "user", id: userId, label: email },
    action: AUDIT.orgCreated,
    metadata: { name: companyName },
  });

  return { ok: true };
}

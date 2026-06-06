"use server";

// Self-serve company registration.
//
// Creates the owner user, then their organization + owner membership + tenant
// settings. How it finishes depends on whether email verification is active
// (RESEND_API_KEY set): if so, the owner is left unverified and the client
// routes them to "check your email"; otherwise the owner is auto-verified and
// signed in (nextCookies forwards the session cookie) and the client redirects
// to /tenant.

import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { member, organization, tenantSettings, user } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { recordAudit, AUDIT } from "@/lib/audit";
import { emailVerificationEnabled } from "@/lib/email-verification";
import { getEnv } from "@/lib/env";

export interface RegisterResult {
  ok: boolean;
  error?: string;
  /** True when the account was created but must verify its email before sign-in. */
  pendingVerification?: boolean;
  /** Echoed back so the client can show "we emailed {email}". */
  email?: string;
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

  // Reject if a session is already active: createOrganization (below) honors the
  // session in the forwarded headers over the passed userId, so a signed-in user
  // submitting this form would get the new org attached to THEIR user instead of
  // the freshly-created one. Make them sign out first. (Invite acceptance for a
  // signed-in user is a separate flow — acceptInviteSignup.)
  const activeSession = await auth.api.getSession({ headers: await headers() });
  if (activeSession?.user) {
    return {
      ok: false,
      error: "You're already signed in. Sign out before creating a new company.",
    };
  }

  // 1. Create the user. NOTE: with requireEmailVerification on, sign-up skips
  // auto-sign-in (no session yet) and sign-in stays blocked until verified. How
  // we finish depends on the email-verification gate — see step 5.
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

  // 5. Finish based on whether real email verification is active.
  if (emailVerificationEnabled(getEnv().RESEND_API_KEY)) {
    // Verification email already dispatched by Better Auth (sendOnSignUp). Leave
    // the user unverified + unsigned-in; the client routes to "check your email".
    // The org + membership already exist, so verifying later drops them straight in.
    return { ok: true, pendingVerification: true, email };
  }

  // No email delivery configured → the creator owns this email anyway, so verify
  // and sign them in (session cookie via nextCookies) so /tenant doesn't bounce.
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
  try {
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not sign in." };
  }

  return { ok: true };
}

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
import { db, dbTx } from "@/lib/db";
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

  // signUpEmail and createOrganization are separate Better-Auth API calls and
  // cannot share a DB transaction with our own writes. So we make this safe two
  // ways: (a) compensating cleanup if any step fails AFTER Better-Auth created
  // the user and/or org, and (b) a real transaction wrapping OUR writes (steps
  // 3 + 4) so they commit together or not at all. The net effect is that a
  // mid-flow failure leaves no orphans, and re-submitting the same email after
  // a cleanup can succeed.
  let createdUserId: string | null = null;
  let createdOrgId: string | null = null;

  // Best-effort rollback: delete the org first (cascades member +
  // tenant_settings), then the user (cascades account/session). Each delete is
  // isolated so one failure doesn't block the other; failures are logged, not
  // thrown, since this already runs on an error path.
  const rollback = async () => {
    if (createdOrgId) {
      try {
        await db.delete(organization).where(eq(organization.id, createdOrgId));
      } catch (cleanupErr) {
        console.error(
          `[registerCompany] cleanup: failed to delete org ${createdOrgId}`,
          cleanupErr,
        );
      }
    }
    if (createdUserId) {
      try {
        await db.delete(user).where(eq(user.id, createdUserId));
      } catch (cleanupErr) {
        console.error(
          `[registerCompany] cleanup: failed to delete user ${createdUserId}`,
          cleanupErr,
        );
      }
    }
  };

  // 1. Create the user. NOTE: with requireEmailVerification on, sign-up skips
  // auto-sign-in (no session yet) and sign-in stays blocked until verified. How
  // we finish depends on the email-verification gate — see step 5. A failure
  // here created nothing, so no cleanup is needed.
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
  createdUserId = userId;

  // Everything past this point can leave orphans on failure (a user with no org,
  // or an org with no settings), so it runs under compensating cleanup.
  let orgId: string;
  try {
    // 2. Create the organization with a unique slug (Better-Auth API call).
    let slug = slugify(companyName);
    const slugTaken = await db
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.slug, slug))
      .limit(1);
    if (slugTaken.length > 0) {
      slug = `${slug}-${id("x").slice(2, 6).toLowerCase()}`;
    }

    const org = await auth.api.createOrganization({
      body: { name: companyName, slug, userId },
      headers: await headers(),
    });
    if (!org) throw new Error("Organization not created.");
    orgId = org.id;
    createdOrgId = orgId;

    // 3 + 4: our own writes, committed atomically via the websocket-backed
    // transactional client (neon-http can't do interactive transactions).
    await dbTx.transaction(async (tx) => {
      // 3. Ensure the owner membership exists (createOrganization usually adds it).
      const existingMember = await tx
        .select({ id: member.id })
        .from(member)
        .where(eq(member.organizationId, orgId))
        .limit(1);
      if (existingMember.length === 0) {
        await tx.insert(member).values({
          id: id("mem"),
          organizationId: orgId,
          userId,
          role: "owner",
          createdAt: new Date(),
        });
      }

      // 4. Seed tenant settings (default per-print price + brand).
      await tx
        .insert(tenantSettings)
        .values({ organizationId: orgId, status: "active" })
        .onConflictDoNothing();
    });

    await recordAudit({
      organizationId: orgId,
      actor: { type: "user", id: userId, label: email },
      action: AUDIT.orgCreated,
      metadata: { name: companyName },
    });
  } catch (err) {
    // Roll back the Better-Auth-created user/org (and anything that cascades)
    // so the caller can safely retry with the same email.
    await rollback();
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not create company.",
    };
  }

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

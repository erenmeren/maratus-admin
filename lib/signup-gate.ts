// Maratus is invite-only: nobody creates their own account.
//
// The self-serve /signup form is gone, but Better Auth still exposes
// POST /api/auth/sign-up/email on the catch-all auth route — a form is not the
// only way to reach it. This gate is what actually closes the door: a sign-up
// is allowed ONLY when a pending, unexpired invitation exists for that exact
// email. It runs as a `hooks.before` middleware in lib/auth.ts, so it covers
// both the public HTTP route and our own server-side `auth.api.signUpEmail`
// call in acceptInviteSignup (lib/actions/members.ts) — which passes precisely
// because the invitation it is accepting is still pending.
//
// A platform admin creates the first user of a new company by inviting its
// owner (lib/actions/customers.ts inviteOwner); everyone else is invited from
// /tenant/members.

import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "./db";
import { invitation } from "./db/schema";

export type SignUpDecision =
  | { ok: true }
  | { ok: false; reason: "no_pending_invitation" };

/** Pure rule: an invitation must be pending and not yet expired. */
export function decideSignUp(a: {
  invitations: { status: string; expiresAt: Date }[];
  now?: Date;
}): SignUpDecision {
  const now = a.now ?? new Date();
  const usable = a.invitations.some(
    (inv) => inv.status === "pending" && inv.expiresAt.getTime() > now.getTime(),
  );
  return usable ? { ok: true } : { ok: false, reason: "no_pending_invitation" };
}

/** Same rule, against the invitation table. Email match is case-insensitive. */
export async function checkSignUpGate(email: string): Promise<SignUpDecision> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { ok: false, reason: "no_pending_invitation" };
  const rows = await db
    .select({ status: invitation.status, expiresAt: invitation.expiresAt })
    .from(invitation)
    .where(
      and(
        sql`lower(${invitation.email}) = ${normalized}`,
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return decideSignUp({ invitations: rows });
}

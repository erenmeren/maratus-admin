// Pure decisions for the Better Auth `hooks.before` middleware in lib/auth.ts.
//
// pinAuthCallbacks: the reset/verification callback is a first-party page and
// must never be caller-controlled. Better Auth validates `redirectTo` /
// `callbackURL` only against trustedOrigins, and the wildcard we keep for
// Vercel previews (https://*.vercel.app) matches ANY vercel.app host — so the
// password-reset callback (which appends the raw token to the redirect) could
// be pointed at an attacker's deployment. Pinning the value server-side closes
// that without touching the origin list.
//
// decideHttpSignUp: accounts are created ONLY by acceptInviteSignup
// (lib/actions/members.ts), which proves possession of the emailed invitation
// id. The public POST /api/auth/sign-up/email must not create accounts —
// with only an email-level invitation check, anyone who knew an invitee's
// address could pre-register it with their own password.
//
// isOrgReadPathBlocked: the org plugin's own read routes hand back the member
// list and pending invitations to any member of the org. Roles that cannot
// view the Members section must not get it through that side door.

import { canView } from "./roles";

const PINNED: Record<string, Record<string, string>> = {
  "/request-password-reset": { redirectTo: "/reset-password" },
  "/send-verification-email": { callbackURL: "/tenant" },
  "/sign-up/email": { callbackURL: "/tenant" },
};

export function pinAuthCallbacks(path: string, body: unknown): Record<string, unknown> | null {
  const pins = PINNED[path];
  if (!pins) return null;
  const base = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return { ...base, ...pins };
}

export type HttpSignUpDecision = { ok: true } | { ok: false; reason: "http_signup_disabled" };

export function decideHttpSignUp(a: { isHttpRequest: boolean }): HttpSignUpDecision {
  return a.isHttpRequest ? { ok: false, reason: "http_signup_disabled" } : { ok: true };
}

const ORG_MEMBER_READ_PATHS = new Set([
  "/organization/list-members",
  "/organization/get-full-organization",
  "/organization/list-invitations",
]);

export function isOrgReadPath(path: string): boolean {
  return ORG_MEMBER_READ_PATHS.has(path);
}

export function isOrgReadPathBlocked(path: string, role: string | null | undefined): boolean {
  return isOrgReadPath(path) && !canView(role, "members");
}

export type GuardedOrg = { kind: "id" | "slug"; value: string };

// Mirrors how Better Auth 1.6.30 picks the org on each read route, so the guard
// checks the same org the plugin will actually return. list-invitations ignores
// organizationSlug entirely; the other two let a slug win. `||` like the plugin,
// so an empty string falls through.
export function resolveGuardedOrg(
  path: string,
  query: { organizationId?: string; organizationSlug?: string } | undefined,
  activeOrganizationId: string | null | undefined,
): GuardedOrg | null {
  if (path !== "/organization/list-invitations" && query?.organizationSlug) {
    return { kind: "slug", value: query.organizationSlug };
  }
  const id = query?.organizationId || activeOrganizationId;
  return id ? { kind: "id", value: id } : null;
}

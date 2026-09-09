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

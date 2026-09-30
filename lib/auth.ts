// Better Auth server instance.
//
// Email/password auth + the organization plugin (organization = tenant).
// A platform-level `role` field on the user lets Maratus staff
// (role = 'platform_admin') see across all organizations — that access is NOT
// an org membership.

import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import { schema } from "./db/schema";
import { getEnv } from "./env";
import { sendEmail } from "./email";
import { checkSignUpGate } from "./signup-gate";
import { computeTrustedOrigins } from "./trusted-origins";
import { decideHttpSignUp, pinAuthCallbacks } from "./auth-hooks";
import {
  expiresInLabel,
  memberInviteEmail,
  resetPasswordEmail,
  verifyEmailEmail,
} from "./auth-emails";

const env = getEnv();

export const auth = betterAuth({
  appName: "Maratus",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: computeTrustedOrigins(
    env.BETTER_AUTH_URL,
    process.env.NODE_ENV === "production",
  ),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    // Demo/seed accounts use a short password (123456); Better Auth's default
    // minimum is 8, which would reject them on a fresh `npm run db:seed`.
    minPasswordLength: 6,
    // Reset links are short-lived. Value is in SECONDS (Better Auth's own
    // default is also 3600, but pin it so a library change can't widen it).
    resetPasswordTokenExpiresIn: 3600,
    // A password reset is how a user evicts whoever else holds their account;
    // every other session must die with it.
    revokeSessionsOnPasswordReset: true,
    // `url` already points at /api/auth/reset-password/{token}?callbackURL=…,
    // which validates the token and then bounces to our /reset-password page.
    sendResetPassword: async ({ user, url }) => {
      const mail = resetPasswordEmail({ url, expiresIn: expiresInLabel(3600 * 1000) });
      await sendEmail(user.email, mail.subject, mail.html);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    // Seconds; pinned (it's also Better Auth's default) so the "expires in"
    // line in the email can't drift from the real token lifetime.
    expiresIn: 3600,
    sendVerificationEmail: async ({ user, url }) => {
      const mail = verifyEmailEmail({
        url,
        email: user.email,
        expiresIn: expiresInLabel(3600 * 1000),
      });
      await sendEmail(user.email, mail.subject, mail.html);
    },
  },
  user: {
    additionalFields: {
      // Platform role: 'user' (default) or 'platform_admin' (Maratus staff).
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false, // not settable via sign-up payload
      },
    },
  },
  hooks: {
    // Invite-only: sign-up is not a public door. Removing the self-serve form
    // isn't enough — POST /api/auth/sign-up/email is still routed by the
    // catch-all handler — so every sign-up, from the HTTP route or from our own
    // auth.api.signUpEmail call, must be backed by a pending invitation.
    // See lib/signup-gate.ts.
    before: createAuthMiddleware(async (ctx) => {
      // Reset/verification callbacks are first-party pages; never trust the
      // caller's redirectTo/callbackURL (see lib/auth-hooks.ts).
      const pinned = pinAuthCallbacks(ctx.path, ctx.body);
      if (pinned) {
        if (ctx.path !== "/sign-up/email") return { context: { body: pinned } };
        // Sign-up: also apply the invite-only gates below, then pin.
      }
      if (ctx.path !== "/sign-up/email") return;

      const http = decideHttpSignUp({ isHttpRequest: ctx.request !== undefined });
      if (!http.ok) {
        throw new APIError("FORBIDDEN", {
          code: "SIGNUP_DISABLED",
          message: "Maratus accounts are invite-only. Use the link in your invitation email.",
        });
      }
      const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "");
      const decision = await checkSignUpGate(email);
      if (!decision.ok) {
        throw new APIError("FORBIDDEN", {
          code: "SIGNUP_DISABLED",
          message: "Maratus accounts are invite-only. Ask a workspace admin to invite you.",
        });
      }
      return { context: { body: pinned } };
    }),
  },
  plugins: [
    organization({
      // Tenants are created by a platform admin (lib/actions/customers.ts) and
      // offboarded by a reversible archive — the plugin's own create/delete
      // routes must not be reachable by tenant users. Seeding still works:
      // auth.api.createOrganization with `userId` and no session is treated as
      // a system action by the plugin.
      allowUserToCreateOrganization: false,
      disableOrganizationDeletion: true,
      async sendInvitationEmail(data) {
        const url = `${env.BETTER_AUTH_URL}/signup?invite=${data.id}`;
        // Inviter name and org name are user-controlled — memberInviteEmail
        // escapes them (an org admin could otherwise put arbitrary HTML into a
        // mail from noreply@maratus.co).
        const mail = memberInviteEmail({
          url,
          inviterName: data.inviter.user.name,
          orgName: data.organization.name,
          role: data.role,
          expiresIn: expiresInLabel(data.invitation.expiresAt.getTime() - Date.now()),
        });
        await sendEmail(data.email, mail.subject, mail.html);
      },
    }),
    // Must be last: forwards Set-Cookie headers in Next.js server actions.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;

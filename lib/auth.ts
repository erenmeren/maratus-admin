// Better Auth server instance.
//
// Email/password auth + the organization plugin (organization = tenant).
// A platform-level `role` field on the user lets Maratus staff
// (role = 'platform_admin') see across all organizations — that access is NOT
// an org membership.

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";
import { schema } from "./db/schema";
import { getEnv } from "./env";
import { sendEmail } from "./email";
import { computeTrustedOrigins } from "./trusted-origins";

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
    // `url` already points at /api/auth/reset-password/{token}?callbackURL=…,
    // which validates the token and then bounces to our /reset-password page.
    sendResetPassword: async ({ user, url }) => {
      await sendEmail(
        user.email,
        "Reset your Maratus password",
        `<p>We got a request to reset the password on your Maratus account.</p>` +
          `<p><a href="${url}">Choose a new password</a></p>` +
          `<p>This link expires in 1 hour. If you didn't ask for it, you can ignore this email.</p>`,
      );
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail(
        user.email,
        "Verify your Maratus account",
        `<p>Welcome to Maratus. Confirm your email to finish setting up your account:</p>` +
          `<p><a href="${url}">Verify my email</a></p>`,
      );
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
  plugins: [
    organization({
      async sendInvitationEmail(data) {
        const url = `${env.BETTER_AUTH_URL}/signup?invite=${data.id}`;
        await sendEmail(
          data.email,
          `You're invited to ${data.organization.name} on Maratus`,
          `<p>${data.inviter.user.name} invited you to join ` +
            `<b>${data.organization.name}</b> on Maratus.</p>` +
            `<p><a href="${url}">Accept the invitation</a></p>`,
        );
      },
    }),
    // Must be last: forwards Set-Cookie headers in Next.js server actions.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;

// Better Auth server instance.
//
// Email/password auth + the organization plugin (organization = tenant).
// A platform-level `role` field on the user lets Ditto staff
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

const env = getEnv();

export const auth = betterAuth({
  appName: "Ditto",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  // Trust the base URL plus all Vercel deployment domains (the production alias
  // and per-deploy preview URLs) so login isn't blocked by INVALID_ORIGIN. In
  // development also trust any localhost port, since `next dev` falls back to a
  // different port when 3000 is taken (which would otherwise be rejected).
  trustedOrigins: [
    "https://*.vercel.app",
    env.BETTER_AUTH_URL,
    ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:*"]),
  ],
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
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail(
        user.email,
        "Verify your Ditto account",
        `<p>Welcome to Ditto. Confirm your email to finish setting up your account:</p>` +
          `<p><a href="${url}">Verify my email</a></p>`,
      );
    },
  },
  user: {
    additionalFields: {
      // Platform role: 'user' (default) or 'platform_admin' (Ditto staff).
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
          `You're invited to ${data.organization.name} on Ditto`,
          `<p>${data.inviter.user.name} invited you to join ` +
            `<b>${data.organization.name}</b> on Ditto.</p>` +
            `<p><a href="${url}">Accept the invitation</a></p>`,
        );
      },
    }),
    // Must be last: forwards Set-Cookie headers in Next.js server actions.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;

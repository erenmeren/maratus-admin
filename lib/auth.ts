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
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
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
    organization(),
    // Must be last: forwards Set-Cookie headers in Next.js server actions.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;

// Typed, zod-validated environment loader.
//
// Import this anywhere you need configuration — it fails fast with a readable
// error if a required variable is missing. Server-only: never import from a
// client component.

import { z } from "zod";

const envSchema = z.object({
  // Neon serverless Postgres connection string.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Better Auth.
  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),

  // Cloudflare R2 (S3-compatible) object storage.
  R2_ACCOUNT_ID: z.string().min(1, "R2_ACCOUNT_ID is required"),
  R2_ACCESS_KEY_ID: z.string().min(1, "R2_ACCESS_KEY_ID is required"),
  R2_SECRET_ACCESS_KEY: z.string().min(1, "R2_SECRET_ACCESS_KEY is required"),
  R2_BUCKET: z.string().min(1, "R2_BUCKET is required"),

  // Transactional email (Resend). Optional: absent → emails are logged, not sent.
  RESEND_API_KEY: z.string().optional(),

  // Stripe billing. All optional: absent → billing features are inert.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  STRIPE_METER_EVENT_NAME: z.string().default("receipts"),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Parse and cache environment variables. Throws a readable error on first call
 * if anything required is missing or malformed.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        "Copy .env.example to .env.local and fill in the values.",
    );
  }
  cached = parsed.data;
  return cached;
}

// Eagerly-evaluated proxy so callers can `import { env } from "@/lib/env"`.
export const env = new Proxy({} as Env, {
  get(_t, prop: string) {
    return getEnv()[prop as keyof Env];
  },
});

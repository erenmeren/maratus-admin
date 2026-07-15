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
  // From-address for transactional email. Defaults to Resend's shared test
  // sender (works with no verified domain, but only delivers to your own Resend
  // account email). Set to "Ditto <noreply@yourdomain.com>" once a domain is
  // verified in Resend.
  EMAIL_FROM: z.string().default("Ditto <onboarding@resend.dev>"),

  // Error tracking (Sentry). All optional: absent → the SDK is never
  // initialized (no-ops). NEXT_PUBLIC_ is required for the browser DSN.
  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default("development"),

  // Stripe billing. All optional: absent → billing features are inert.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  // Comma-separated list of credit packs: `packId:priceId:credits[,...]`
  // e.g. `small:price_abc:100,large:price_def:1000`
  STRIPE_CREDIT_PACK_PRICE_IDS: z.string().optional(),

  // Per-device monthly Stripe prices (dual-track pricing). Tier discounts are
  // configured on the price objects in Stripe, not in code.
  STRIPE_FLAT_PRICE_ID: z.string().optional(),
  STRIPE_BASE_PRICE_ID: z.string().optional(),

  // Shared secret for the scheduled cron endpoint(s). Vercel sends it as
  // `Authorization: Bearer <CRON_SECRET>`. Absent → the cron route returns 503.
  CRON_SECRET: z.string().optional(),

  // ---- EMQX / MQTT device transport ----
  // All optional as a group. Absent → MQTT is disabled and the device transport
  // falls back to HTTP polling (mqttEnabled() in lib/mqtt.ts gates on these).
  // EMQX Cloud Serverless HTTP API base, e.g. https://xxxx.eu-central-1.emqxsl.com:8443/api/v5
  EMQX_API_URL: z.string().optional(),
  // EMQX API key/secret (created in the EMQX console → API Keys).
  EMQX_API_KEY: z.string().optional(),
  EMQX_API_SECRET: z.string().optional(),
  // Shared secret the EMQX Data-Integration webhooks send back to us in the
  // `x-emqx-webhook-secret` header. We reject any webhook that doesn't match.
  EMQX_WEBHOOK_SECRET: z.string().optional(),
  // The broker host the device connects to over TLS (mqtts://<host>:<port>),
  // e.g. xxxx.eu-central-1.emqxsl.com — delivered to the device in config.
  MQTT_BROKER_HOST: z.string().optional(),
  MQTT_BROKER_PORT: z.coerce.number().default(8883),
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

// vitest setup for lib/billing tests — mocks server-only IO modules so the
// pure-function tests in stripe-billing.test.ts run without a live DB or Stripe.
import { vi } from "vitest";

vi.mock("@/lib/stripe", () => ({ stripe: null }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ tenantSettings: {} }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ STRIPE_PRICE_ID: undefined, STRIPE_METER_EVENT_NAME: "receipts", DATABASE_URL: "postgres://mock" }) }));
vi.mock("drizzle-orm", () => ({ eq: () => undefined }));

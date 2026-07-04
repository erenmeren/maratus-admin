// lib/billing/stripe-billing.ts
// Stripe billing IO: customer creation and credit-pack checkout. Only path
// left after the credits-only trim (Task 6) — subscriptions/invoices/metered
// usage are gone.

import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { eq } from "drizzle-orm";
import { findPack } from "./credit-packs";

function requireStripe() {
  if (!stripe) throw new Error("Stripe is not configured");
  return stripe;
}

/** Find-or-create the Stripe Customer for an org; persists the id. */
export async function ensureStripeCustomer(organizationId: string): Promise<string> {
  const s = requireStripe();
  const [settings] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, organizationId))
    .limit(1);
  if (settings?.stripeCustomerId) return settings.stripeCustomerId;

  const customer = await s.customers.create({ metadata: { organizationId } });
  await db
    .update(tenantSettings)
    .set({ stripeCustomerId: customer.id })
    .where(eq(tenantSettings.organizationId, organizationId));
  return customer.id;
}

/**
 * Create a one-time Checkout Session for a credit pack (`mode: "payment"`,
 * `ui_mode: "elements"`). The webhook grants the credits after payment.
 */
export async function createCreditCheckout(
  organizationId: string,
  packId: string,
): Promise<{ clientSecret: string }> {
  const s = requireStripe();
  const pack = findPack(packId);
  if (!pack) throw new Error("Unknown credit pack");

  const customerId = await ensureStripeCustomer(organizationId);
  const session = await s.checkout.sessions.create({
    mode: "payment",
    ui_mode: "elements",
    customer: customerId,
    line_items: [{ price: pack.priceId, quantity: 1 }],
    metadata: {
      organizationId,
      packId: pack.id,
      credits: String(pack.credits),
    },
    return_url: `${getEnv().BETTER_AUTH_URL}/tenant/billing`,
  });

  if (!session.client_secret) {
    throw new Error("No client secret for credit checkout");
  }
  return { clientSecret: session.client_secret };
}

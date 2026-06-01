// lib/billing/stripe-billing.ts
// Stripe billing IO: customer, subscription, and metered usage. Pure mappers
// live in ./billing-status and are re-exported here for convenience.

import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { eq } from "drizzle-orm";
import { meterEventPayload } from "./billing-status";

export { statusForStripeInvoice, meterEventPayload } from "./billing-status";

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
 * Create a Checkout Session in subscription mode (`ui_mode: "elements"`) and
 * return its client secret. Stripe's recommended path for starting a
 * subscription: Checkout creates the subscription and captures the card on
 * confirm; we learn the subscription id/status via webhook. The metered first
 * invoice is $0, so no immediate charge — the card is saved for off-session use.
 */
export async function activateBilling(organizationId: string): Promise<{ clientSecret: string }> {
  const s = requireStripe();
  const priceId = getEnv().STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID is not configured");

  const customerId = await ensureStripeCustomer(organizationId);
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    ui_mode: "elements",
    customer: customerId,
    line_items: [{ price: priceId }],
    return_url: `${getEnv().BETTER_AUTH_URL}/tenant/billing`,
  });

  if (!session.client_secret) {
    throw new Error("No client secret returned for checkout session");
  }
  return { clientSecret: session.client_secret };
}

/** Fire one metered usage event for a customer. Caller handles errors. */
export async function reportReceiptUsage(stripeCustomerId: string): Promise<void> {
  const s = requireStripe();
  const { event_name, payload } = meterEventPayload(
    stripeCustomerId,
    getEnv().STRIPE_METER_EVENT_NAME,
  );
  await s.billing.meterEvents.create({ event_name, payload });
}

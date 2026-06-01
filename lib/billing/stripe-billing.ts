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
 * Create a metered subscription in `default_incomplete` mode and return the
 * setup-intent client secret (metered first invoice is $0, so Stripe attaches a
 * pending_setup_intent to collect the card).
 */
export async function activateBilling(organizationId: string): Promise<{ clientSecret: string }> {
  const s = requireStripe();
  const priceId = getEnv().STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID is not configured");

  const customerId = await ensureStripeCustomer(organizationId);
  const sub = await s.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: "default_incomplete",
    expand: ["pending_setup_intent"],
  });

  await db
    .update(tenantSettings)
    .set({ stripeSubscriptionId: sub.id, subscriptionStatus: sub.status })
    .where(eq(tenantSettings.organizationId, organizationId));

  const intent = sub.pending_setup_intent;
  if (!intent || typeof intent === "string" || !intent.client_secret) {
    throw new Error("No setup intent returned for subscription");
  }
  return { clientSecret: intent.client_secret };
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

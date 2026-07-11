// Keeps the per-device Stripe subscription in sync with the org's claimed
// device count (flat / base_usage plans). Every entry point is fail-open:
// device operations must never block on Stripe. proration_behavior "none"
// keeps mid-month device churn from generating micro-prorations; the new
// quantity simply applies from the next invoice.

import { and, count, eq, isNotNull, ne } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { device, tenantSettings } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import type { BillingPlan } from "@/lib/billing-plan";
import { ensureStripeCustomer } from "./stripe-billing";
import { desiredSubscriptionState } from "./device-subscription-logic";

function planPriceId(plan: BillingPlan): string | null {
  const env = getEnv();
  if (plan === "flat") return env.STRIPE_FLAT_PRICE_ID ?? null;
  if (plan === "base_usage") return env.STRIPE_BASE_PRICE_ID ?? null;
  return null;
}

/** Reconcile one org's device subscription with its plan + claimed-device count. */
export async function syncDeviceSubscription(organizationId: string): Promise<void> {
  if (!stripe) return; // Stripe unconfigured → no-op
  const [settings] = await db
    .select({
      plan: tenantSettings.billingPlan,
      subId: tenantSettings.stripeSubscriptionId,
      itemId: tenantSettings.stripeSubscriptionItemId,
      archivedAt: tenantSettings.archivedAt,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, organizationId))
    .limit(1);
  if (!settings) return;

  const [{ n }] = await db
    .select({ n: count() })
    .from(device)
    .where(and(eq(device.organizationId, organizationId), isNotNull(device.claimedAt)));

  const plan: BillingPlan = settings.archivedAt ? "credits" : settings.plan; // archived → wind down
  const desired = desiredSubscriptionState({
    plan,
    deviceCount: Number(n),
    hasSubscription: settings.subId !== null,
    priceId: planPriceId(plan),
  });

  if (desired.action === "none") return;

  if (desired.action === "cancel") {
    if (settings.subId) await stripe.subscriptions.cancel(settings.subId);
    await db
      .update(tenantSettings)
      .set({ stripeSubscriptionId: null, stripeSubscriptionItemId: null })
      .where(eq(tenantSettings.organizationId, organizationId));
    return;
  }

  if (desired.action === "create") {
    const customerId = await ensureStripeCustomer(organizationId);
    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: desired.priceId, quantity: desired.quantity }],
      proration_behavior: "none",
      metadata: { organizationId },
    });
    await db
      .update(tenantSettings)
      .set({ stripeSubscriptionId: sub.id, stripeSubscriptionItemId: sub.items.data[0].id })
      .where(eq(tenantSettings.organizationId, organizationId));
    return;
  }

  // update: quantity (and price, covering flat <-> base_usage plan switches)
  if (settings.itemId) {
    await stripe.subscriptionItems.update(settings.itemId, {
      price: desired.priceId,
      quantity: desired.quantity,
      proration_behavior: "none",
    });
  }
}

/** Daily reconcile across all plan orgs (folded into the health cron). */
export async function syncAllDeviceSubscriptions(): Promise<{ synced: number; failed: number }> {
  const orgs = await db
    .select({ organizationId: tenantSettings.organizationId })
    .from(tenantSettings)
    .where(ne(tenantSettings.billingPlan, "credits"));
  let synced = 0;
  let failed = 0;
  for (const o of orgs) {
    try {
      await syncDeviceSubscription(o.organizationId);
      synced++;
    } catch (err) {
      failed++;
      console.error(`device-subscription sync failed for ${o.organizationId}`, err);
    }
  }
  return { synced, failed };
}

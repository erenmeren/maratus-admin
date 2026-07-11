// Keeps the per-device Stripe subscription in sync with the org's claimed
// device count (flat / base_usage plans). Every entry point is fail-open:
// device operations must never block on Stripe. proration_behavior "none"
// keeps mid-month device churn from generating micro-prorations; the new
// quantity simply applies from the next invoice.

import { and, count, eq, isNotNull, ne, or } from "drizzle-orm";
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

// Stripe throws when acting on a subscription that no longer exists or was
// already canceled out-of-band; for sync purposes "gone" and "canceled" are
// success — we just need our columns to catch up.
function isGoneSubscriptionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return (
    e?.code === "resource_missing" ||
    // Stripe's wording varies by endpoint: "This subscription is already
    // canceled", "You cannot update a subscription that is `canceled` or
    // `incomplete_expired`", "No such subscription: ...". Match them all.
    /canceled subscription|no such subscription|already canceled|subscription that is `?canceled|incomplete_expired/i.test(
      e?.message ?? "",
    )
  );
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
    if (settings.subId) {
      try {
        await stripe.subscriptions.cancel(settings.subId);
      } catch (err) {
        if (!isGoneSubscriptionError(err)) throw err;
      }
    }
    // Whether we canceled it or it was already gone, our columns must catch up.
    await db
      .update(tenantSettings)
      .set({ stripeSubscriptionId: null, stripeSubscriptionItemId: null })
      .where(eq(tenantSettings.organizationId, organizationId));
    return;
  }

  if (desired.action === "create") {
    const customerId = await ensureStripeCustomer(organizationId);
    // Idempotency key guards against a concurrent burst of claims (e.g. one
    // sync per auto-claim during a zero-touch fleet install) minting
    // duplicate subscriptions. Stripe idempotency keys expire after 24h, so a
    // same-key replay within that window returns the same subscription —
    // exactly what the concurrent burst needs. A cancel-then-recreate inside
    // 24h would replay the canceled sub's response, but Fix 2's update-path
    // gone-subscription healing corrects that on the very next sync.
    const sub = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: desired.priceId, quantity: desired.quantity }],
        proration_behavior: "none",
        metadata: { organizationId },
      },
      { idempotencyKey: `devsub-create-${organizationId}` },
    );
    await db
      .update(tenantSettings)
      .set({ stripeSubscriptionId: sub.id, stripeSubscriptionItemId: sub.items.data[0].id })
      .where(eq(tenantSettings.organizationId, organizationId));
    return;
  }

  // update: quantity (and price, covering flat <-> base_usage plan switches)
  if (settings.itemId) {
    try {
      await stripe.subscriptionItems.update(settings.itemId, {
        price: desired.priceId,
        quantity: desired.quantity,
        proration_behavior: "none",
      });
    } catch (err) {
      if (!isGoneSubscriptionError(err)) throw err;
      // The subscription was canceled out-of-band; null out both columns so
      // the next sync sees hasSubscription: false and re-creates it.
      await db
        .update(tenantSettings)
        .set({ stripeSubscriptionId: null, stripeSubscriptionItemId: null })
        .where(eq(tenantSettings.organizationId, organizationId));
    }
  }
}

/** Daily reconcile across all plan orgs (folded into the health cron). */
export async function syncAllDeviceSubscriptions(): Promise<{ synced: number; failed: number }> {
  const orgs = await db
    .select({ organizationId: tenantSettings.organizationId })
    .from(tenantSettings)
    .where(
      or(
        ne(tenantSettings.billingPlan, "credits"),
        isNotNull(tenantSettings.stripeSubscriptionId),
      ),
    );
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

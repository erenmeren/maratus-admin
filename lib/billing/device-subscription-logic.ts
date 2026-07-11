// Pure reconciliation decision for the per-device quantity subscription.
// The IO wrapper (device-subscription.ts) reads state, calls this, applies.

import type { BillingPlan } from "@/lib/billing-plan";

export type DesiredSub =
  | { action: "none" }
  | { action: "cancel" }
  | { action: "create"; priceId: string; quantity: number }
  | { action: "update"; priceId: string; quantity: number };

export function desiredSubscriptionState(a: {
  plan: BillingPlan;
  deviceCount: number;
  hasSubscription: boolean;
  priceId: string | null;
}): DesiredSub {
  if (a.plan === "credits" || a.deviceCount === 0)
    return a.hasSubscription ? { action: "cancel" } : { action: "none" };
  // Plan is billable but the price env var is missing: configuration error,
  // not a wind-down — never touch an existing subscription over it.
  if (!a.priceId) return { action: "none" };
  return a.hasSubscription
    ? { action: "update", priceId: a.priceId, quantity: a.deviceCount }
    : { action: "create", priceId: a.priceId, quantity: a.deviceCount };
}

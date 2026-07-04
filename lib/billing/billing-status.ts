// lib/billing/billing-status.ts
// Pure, IO-free subscription-status mapper. Credits are the sole payment path;
// this file now only maps a Stripe subscription status onto our suspension
// state (used by lib/tenant-health.ts). No DB/env/Stripe-client imports here
// so this stays unit-testable in isolation.

const SUSPENDED_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

/** True when a subscription is terminally unpaid (org should be suspended). */
export function isSuspended(subscriptionStatus: string | null): boolean {
  return subscriptionStatus != null && SUSPENDED_STATUSES.has(subscriptionStatus);
}

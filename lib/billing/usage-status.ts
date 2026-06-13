// lib/billing/usage-status.ts
// Pure, IO-free usage-metering state machine. No DB/env/Stripe imports here so
// it can be unit-tested in isolation (the IO lives in usage-metering.ts), matching
// the stripe-billing.ts ↔ billing-status.ts split.

export type UsageStatus = "pending" | "reported" | "skipped";

/** Rows with this many attempts stop being retried (left "pending" for visibility). */
export const MAX_USAGE_ATTEMPTS = 10;

/**
 * Decide the next status of a usage event given the current status, whether a
 * Stripe report just succeeded, and whether the row has a customer to bill.
 * Terminal states (reported/skipped) never transition.
 *
 *   - already terminal → unchanged
 *   - no customer      → "skipped" (nothing to bill)
 *   - report succeeded → "reported"
 *   - report failed    → "pending" (eligible for retry)
 */
export function nextUsageStatus(
  currentStatus: UsageStatus,
  reportSucceeded: boolean,
  hasCustomer: boolean,
): UsageStatus {
  // Terminal states are immutable.
  if (currentStatus === "reported" || currentStatus === "skipped") {
    return currentStatus;
  }
  if (!hasCustomer) return "skipped";
  return reportSucceeded ? "reported" : "pending";
}

// Pure decision logic for the dual-track pricing plans
// (docs/superpowers/specs/2026-07-11-pricing-dual-track-design.md).

export type BillingPlan = "credits" | "flat" | "base_usage";

/** Fair-use ceiling for flat-plan devices (~10K/day; abuse valve, not a bill). */
export const FAIR_USE_TRIGGERS_PER_DEVICE_MONTH = 300_000;

/** Track C default: triggers included per device per calendar month. */
export const DEFAULT_INCLUDED_TRIGGERS = 2_000;

/** Calendar-month key in UTC, e.g. "2026-07". */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type TriggerBillingDecision =
  | { mode: "credits" } // reserve a credit hold (legacy path)
  | { mode: "included" } // covered by the plan; no credit movement
  | { mode: "fair_use_exceeded" }; // flat plan over the ceiling → reject

/**
 * Decide how a trigger is paid. `usedThisMonth` is the device's usage counter
 * AFTER counting this trigger (bump-then-decide), so `<=` keeps boundary
 * triggers included.
 */
export function triggerBillingDecision(a: {
  plan: BillingPlan;
  includedTriggersPerDevice: number;
  usedThisMonth: number;
}): TriggerBillingDecision {
  switch (a.plan) {
    case "flat":
      return a.usedThisMonth > FAIR_USE_TRIGGERS_PER_DEVICE_MONTH
        ? { mode: "fair_use_exceeded" }
        : { mode: "included" };
    case "base_usage":
      return a.usedThisMonth <= a.includedTriggersPerDevice
        ? { mode: "included" }
        : { mode: "credits" };
    case "credits":
      return { mode: "credits" };
  }
}

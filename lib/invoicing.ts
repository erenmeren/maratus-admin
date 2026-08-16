// Pure invoice arithmetic. No database, no dates beyond what callers pass in.
// Persistence lives in lib/invoices.ts; keeping the money math here is what
// makes it exhaustively testable.

import { addMonthsAnchored, MONTHS_PER_YEAR, periodIndexFor } from "./billing-period";

export const DEFAULT_PRICE_PER_DEVICE_CENTS = 1500; // $15/device/month
export const DEFAULT_OVERAGE_PRICE_CENTS = 2; // $0.02/trigger past the pool
export const DEFAULT_INCLUDED_TRIGGERS_PER_DEVICE = 1000;
export const DUE_DAYS = 14;

/** Free acked triggers an unpaid device may make, lifetime. */
export const TRIAL_TRIGGERS_PER_DEVICE = 50;

/**
 * Abuse valve only. Nothing in the request path blocks on it — the daily
 * billing cron sweeps for devices past it and raises an alert.
 */
export const FAIR_USE_TRIGGERS_PER_DEVICE_MONTH = 300_000;

/** A full year of subscription for `deviceCount` devices. */
export function subscriptionAmountCents(
  deviceCount: number,
  pricePerDeviceCents: number,
): number {
  return deviceCount * pricePerDeviceCents * MONTHS_PER_YEAR;
}

/**
 * Whole months left until renewal, rounding a partial month UP so a device
 * added late in a month is never billed zero. Clamped to [0, 12].
 */
export function monthsRemainingUntil(renewsAt: Date, now: Date): number {
  if (now.getTime() >= renewsAt.getTime()) return 0;
  // Whole months from now to the renewal instant; anything left over is a
  // partial month that still costs a full one.
  const whole = periodIndexFor(now, renewsAt);
  const landsExactly = addMonthsAnchored(now, whole).getTime() === renewsAt.getTime();
  const months = landsExactly ? whole : whole + 1;
  return Math.min(MONTHS_PER_YEAR, Math.max(0, months));
}

/**
 * Months a proration is actually billed for. Never zero: a device claimed at
 * or after `subscriptionRenewsAt` — routine for any org sitting on an unpaid
 * renewal, which the no-cut-off policy makes a normal state — would otherwise
 * price at $0, produce no invoice, and leave the device claimed, unpaid and
 * invisible. A full month is the smallest honest charge.
 */
export function prorationMonths(monthsRemaining: number): number {
  return Math.min(MONTHS_PER_YEAR, Math.max(1, monthsRemaining));
}

/** One device for the remaining months of an existing subscription year. */
export function prorationAmountCents(
  pricePerDeviceCents: number,
  monthsRemaining: number,
): number {
  return pricePerDeviceCents * monthsRemaining;
}

/**
 * Overage for one closed period. Quota is pooled across paid SLOTS — what the
 * org paid for, not a live device count — so an RMA'd device freeing its slot
 * never shrinks the pool. Legacy credits (migrated prepaid balance) offset
 * the overage before billing.
 */
export function overageFor(a: {
  used: number;
  includedPerDevice: number;
  slotCount: number;
  overagePriceCents: number;
  legacyCredits: number;
}): {
  includedTotal: number;
  overageTriggers: number;
  creditsConsumed: number;
  billableTriggers: number;
  amountUsdCents: number;
} {
  const includedTotal = a.slotCount * a.includedPerDevice;
  const overageTriggers = Math.max(0, a.used - includedTotal);
  const creditsConsumed = Math.min(Math.max(0, a.legacyCredits), overageTriggers);
  const billableTriggers = overageTriggers - creditsConsumed;
  return {
    includedTotal,
    overageTriggers,
    creditsConsumed,
    billableTriggers,
    amountUsdCents: billableTriggers * a.overagePriceCents,
  };
}

/** Net-14 due date. */
export function dueAtFrom(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + DUE_DAYS * 24 * 60 * 60 * 1000);
}

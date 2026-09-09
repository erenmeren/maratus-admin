// Anniversary-based billing period arithmetic (pure, UTC only).
// A subscription's anchor is its start instant; every period boundary is that
// instant shifted by whole months. The anchor's day-of-month is preserved even
// when an intervening month is too short — clamping is per-computation, never
// carried forward, or every February would walk the billing date backwards.

export const MONTHS_PER_YEAR = 12;

/** Shift `anchor` by whole months, clamping to the target month's last day. */
export function addMonthsAnchored(anchor: Date, months: number): Date {
  const day = anchor.getUTCDate();
  // Land on the 1st of the target month first, so the day-of-month can never
  // roll the month over before we clamp it.
  const target = new Date(
    Date.UTC(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth() + months,
      1,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** How many whole anniversary months have elapsed since `anchor` at `now`. */
export function periodIndexFor(anchor: Date, now: Date): number {
  const rough =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * MONTHS_PER_YEAR +
    (now.getUTCMonth() - anchor.getUTCMonth());
  // The calendar-month difference overshoots whenever `now` sits before the
  // anchor's day/time within its month (and after clamping), so step back once.
  return addMonthsAnchored(anchor, rough).getTime() > now.getTime() ? rough - 1 : rough;
}

/** Inclusive start of the period containing `now`. */
export function periodStartFor(anchor: Date, now: Date): Date {
  return addMonthsAnchored(anchor, periodIndexFor(anchor, now));
}

/** Exclusive end of the period containing `now` (= next period's start). */
export function periodEndFor(anchor: Date, now: Date): Date {
  return addMonthsAnchored(anchor, periodIndexFor(anchor, now) + 1);
}

/**
 * Midnight UTC of `d`'s day. Invoice `periodStart` values must be truncated to
 * a day before they are stored: the unique (organizationId, kind, periodStart)
 * index is the only thing preventing duplicate invoices, and a millisecond
 * timestamp never collides, so the index would never fire.
 */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** When a subscription anchored at `anchor` comes up for renewal. */
export function renewalDueAt(anchor: Date): Date {
  return addMonthsAnchored(anchor, MONTHS_PER_YEAR);
}

/**
 * The anniversary after `currentRenewsAt`, computed from the ANCHOR rather than
 * by adding 12 months to the current date: a Feb-29 anchor renews on Feb-28 in
 * common years, and adding 12 months to Feb-28 would keep it there forever,
 * while periodStartFor(anchor, …) lands on Feb-29 again in the next leap year.
 * Deriving from the anchor keeps the renewal date on the same grid as every
 * period boundary. Rounds the elapsed cycles so a renewsAt that sits a day off
 * the grid (clamped) still maps to the right cycle.
 */
export function nextRenewalAt(startedAt: Date, currentRenewsAt: Date): Date {
  const cycles = Math.round(periodIndexFor(startedAt, currentRenewsAt) / MONTHS_PER_YEAR);
  return addMonthsAnchored(startedAt, MONTHS_PER_YEAR * (cycles + 1));
}

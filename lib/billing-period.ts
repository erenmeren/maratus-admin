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

/** When a subscription anchored at `anchor` comes up for renewal. */
export function renewalDueAt(anchor: Date): Date {
  return addMonthsAnchored(anchor, MONTHS_PER_YEAR);
}

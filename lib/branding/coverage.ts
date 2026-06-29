// lib/branding/coverage.ts
// Pure: validate + compute the optional return/warranty windows shown on the
// public document page. Single source of truth for the settings-form validation
// and the public-page display math. No IO. `now` is injected for determinism.

const DAY_MS = 24 * 60 * 60 * 1000;

export function isValidWindowDays(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 3650;
}

export function isValidWarrantyMonths(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 120;
}

/** Add whole calendar months, clamping overflow to the last day of the target month. */
export function addCalendarMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1); // avoid roll-over while shifting the month
  d.setUTCMonth(d.getUTCMonth() + months);
  // Last valid day of the now-current month.
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export interface CoverageWindow {
  untilDate: Date;
  expired: boolean;
}

export interface Coverage {
  return: CoverageWindow | null;
  warranty: CoverageWindow | null;
  show: boolean;
}

export function coverageStatus(
  input: {
    createdAt: Date;
    returnWindowDays: number | null;
    warrantyPeriodMonths: number | null;
  },
  now: Date,
): Coverage {
  const ret =
    input.returnWindowDays != null && isValidWindowDays(input.returnWindowDays)
      ? windowFrom(new Date(input.createdAt.getTime() + input.returnWindowDays * DAY_MS), now)
      : null;

  const warranty =
    input.warrantyPeriodMonths != null && isValidWarrantyMonths(input.warrantyPeriodMonths)
      ? windowFrom(addCalendarMonths(input.createdAt, input.warrantyPeriodMonths), now)
      : null;

  return { return: ret, warranty, show: ret != null || warranty != null };
}

function windowFrom(untilDate: Date, now: Date): CoverageWindow {
  return { untilDate, expired: now.getTime() > untilDate.getTime() };
}

// lib/billing/dunning.ts
// Pure, IO-free dunning decisions (Phase 1B). No DB/env/Stripe imports — the IO
// that uses these lives in enforcement.ts and billing-cron.ts.
import { isSuspended } from "./billing-status";

export const GRACE_DAYS = 7;
const DAY_MS = 86_400_000;

/** A stable mid-day date inside the calendar month BEFORE `now` (local time, to
 * match runInvoiceGeneration's local month boundaries). */
export function previousMonthMarker(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() - 1, 15, 12, 0, 0, 0);
}

/** A sent invoice whose due date has passed should flip to overdue. */
export function isOverdue(
  inv: { status: string; dueDate: Date | null },
  now: Date,
): boolean {
  return inv.status === "sent" && inv.dueDate != null && inv.dueDate.getTime() < now.getTime();
}

/** An overdue invoice past the grace window should trigger a hard block. */
export function isPastGrace(
  inv: { status: string; dueDate: Date | null },
  now: Date,
): boolean {
  return (
    inv.status === "overdue" &&
    inv.dueDate != null &&
    inv.dueDate.getTime() + GRACE_DAYS * DAY_MS < now.getTime()
  );
}

/** Combine subscription + invoice state into a single block verdict. Suspended
 * subscriptions take precedence over past-due invoices. */
export function paymentBlockVerdict(input: {
  subscriptionStatus: string | null;
  hasPastGraceOverdue: boolean;
}): { blocked: boolean; reason: "suspended" | "past_due" | null } {
  if (isSuspended(input.subscriptionStatus)) return { blocked: true, reason: "suspended" };
  if (input.hasPastGraceOverdue) return { blocked: true, reason: "past_due" };
  return { blocked: false, reason: null };
}

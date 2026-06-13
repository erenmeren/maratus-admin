// lib/billing/usage-metering.ts
// Durable Stripe usage metering. Every billable receipt gets a `usage_event`
// ledger row at ingest time; that row is the durability guarantee. Reporting to
// Stripe is best-effort and retried by the /api/cron/usage reconciler, so a
// dropped meter event can never silently un-bill a receipt.
//
// The pure status-transition helper (`nextUsageStatus`) is IO-free and unit
// tested in isolation; everything else does DB/Stripe IO and never throws into
// its caller.

import { and, eq, lt, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageEvent } from "@/lib/db/schema";
import { stripe } from "@/lib/stripe";
import { reportReceiptUsage } from "./stripe-billing";
import { id } from "@/lib/ids";
import { reportError } from "@/lib/observability";
import { MAX_USAGE_ATTEMPTS, nextUsageStatus } from "./usage-status";

// The pure state machine lives in ./usage-status (IO-free, unit-tested there);
// re-export the surface so callers can import it from this module too.
export { MAX_USAGE_ATTEMPTS, nextUsageStatus };
export type { UsageStatus } from "./usage-status";

type UsageEventRow = typeof usageEvent.$inferSelect;

/**
 * Insert a usage_event ledger row for a receipt. Idempotent: the receiptId
 * unique index + onConflictDoNothing means a duplicate call is a no-op. Rows
 * land "pending" when there's a customer + Stripe configured, else "skipped".
 * Never throws — returns the row id, or null on a no-op/error.
 */
export async function recordUsageEvent(input: {
  organizationId: string;
  receiptId: string;
  stripeCustomerId: string | null | undefined;
}): Promise<string | null> {
  const hasCustomer = Boolean(input.stripeCustomerId) && Boolean(stripe);
  const rowId = id("ue");
  try {
    const inserted = await db
      .insert(usageEvent)
      .values({
        id: rowId,
        organizationId: input.organizationId,
        receiptId: input.receiptId,
        stripeCustomerId: input.stripeCustomerId ?? null,
        status: hasCustomer ? "pending" : "skipped",
      })
      .onConflictDoNothing({ target: usageEvent.receiptId })
      .returning({ id: usageEvent.id });
    return inserted[0]?.id ?? null;
  } catch (err) {
    console.error("[usage] failed to record usage event", input.receiptId, err);
    reportError(err, {
      path: "usage.record",
      extra: { orgId: input.organizationId, receiptId: input.receiptId },
    });
    return null;
  }
}

/**
 * Attempt to report one usage event to Stripe. On success → "reported" +
 * reportedAt. On failure → attempts++ but stays "pending" for the reconciler.
 * If there's no customer or Stripe is unconfigured → "skipped". Never throws.
 */
export async function reportUsageEvent(row: UsageEventRow): Promise<{ ok: boolean }> {
  // Already terminal — nothing to do.
  if (row.status !== "pending") return { ok: true };

  const hasCustomer = Boolean(row.stripeCustomerId) && Boolean(stripe);
  if (!hasCustomer) {
    const status = nextUsageStatus(row.status, false, false); // → "skipped"
    try {
      await db
        .update(usageEvent)
        .set({ status, attempts: row.attempts + 1 })
        .where(eq(usageEvent.id, row.id));
    } catch (err) {
      console.error("[usage] failed to mark skipped", row.id, err);
      reportError(err, { path: "usage.skip", extra: { orgId: row.organizationId, usageEventId: row.id } });
    }
    return { ok: true };
  }

  let reportSucceeded = false;
  try {
    await reportReceiptUsage(row.stripeCustomerId!);
    reportSucceeded = true;
  } catch (err) {
    console.error("[usage] meter event failed", row.id, err);
    reportError(err, { path: "usage.report", extra: { orgId: row.organizationId, usageEventId: row.id } });
  }

  const status = nextUsageStatus(row.status, reportSucceeded, true);
  try {
    await db
      .update(usageEvent)
      .set({
        status,
        attempts: row.attempts + 1,
        ...(reportSucceeded ? { reportedAt: new Date() } : {}),
      })
      .where(eq(usageEvent.id, row.id));
  } catch (err) {
    console.error("[usage] failed to persist usage status", row.id, err);
    reportError(err, { path: "usage.persist", extra: { orgId: row.organizationId, usageEventId: row.id } });
  }

  return { ok: reportSucceeded };
}

/**
 * Reconcile pending usage events: re-attempt reporting for rows older than a
 * small delay (so the inline ingest attempt had its chance) and under the
 * attempt cap. Rows at/over MAX_USAGE_ATTEMPTS are left "pending" on purpose so
 * a persistent failure stays visible rather than vanishing into a terminal
 * state. Returns per-outcome counts.
 */
export async function reconcilePendingUsage(
  now: Date,
  limit = 200,
): Promise<{ reported: number; failed: number; skipped: number }> {
  // Give the inline attempt ~60s before the cron retries.
  const cutoff = new Date(now.getTime() - 60_000);

  let pending: UsageEventRow[];
  try {
    pending = await db
      .select()
      .from(usageEvent)
      .where(
        and(
          eq(usageEvent.status, "pending"),
          lte(usageEvent.createdAt, cutoff),
          lt(usageEvent.attempts, MAX_USAGE_ATTEMPTS),
        ),
      )
      .limit(limit);
  } catch (err) {
    console.error("[usage] reconcile query failed", err);
    reportError(err, { path: "usage.reconcile" });
    return { reported: 0, failed: 0, skipped: 0 };
  }

  let reported = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of pending) {
    const hasCustomer = Boolean(row.stripeCustomerId) && Boolean(stripe);
    const res = await reportUsageEvent(row);
    if (!hasCustomer) skipped++;
    else if (res.ok) reported++;
    else failed++;
  }

  return { reported, failed, skipped };
}

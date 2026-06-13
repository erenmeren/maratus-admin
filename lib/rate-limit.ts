// Cross-instance fixed-window rate limiter, backed by Neon Postgres.
//
// Every serverless instance shares the `rate_limit` table, so the limit is
// actually enforced — the old module-level Map only throttled a single warm
// instance and reset on cold start. The window math lives in the pure,
// IO-free lib/rate-limit-window.ts so it stays unit-testable without lib/db.

import { sql } from "drizzle-orm";
import { db } from "./db";
import { rateLimit } from "./db/schema";
import {
  computeWindowStart,
  decide,
  type RateLimitOpts,
  type RateLimitResult,
} from "./rate-limit-window";

export {
  computeWindowStart,
  decide,
  type RateLimitOpts,
  type RateLimitResult,
} from "./rate-limit-window";

/**
 * Atomically record a hit for `key` and decide if it's allowed. The fixed-window
 * counter is incremented-or-reset in a single UPSERT: insert `(key, windowStart,
 * 1)`, and on key conflict bump the count when it's still the same window, else
 * reset to 1 for the new window. The post-update count drives the decision.
 *
 * Fails OPEN: a DB error logs and returns allowed, so a transient blip can never
 * hard-block ingestion (mirrors the ingest suspension-check fail-safe).
 */
export async function checkRateLimit(
  key: string,
  { limit, windowMs }: RateLimitOpts,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = computeWindowStart(now, windowMs);
  const windowStartDate = new Date(windowStart);

  try {
    const [row] = await db
      .insert(rateLimit)
      .values({ key, windowStart: windowStartDate, count: 1 })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: {
          // Single atomic statement: same window → increment, else reset to 1.
          count: sql`CASE WHEN ${rateLimit.windowStart} = ${windowStartDate} THEN ${rateLimit.count} + 1 ELSE 1 END`,
          windowStart: windowStartDate,
        },
      })
      .returning({ count: rateLimit.count, windowStart: rateLimit.windowStart });

    return decide(row.count, limit, windowStart, windowMs, now);
  } catch (err) {
    // Fail safe (allow) — a DB blip must not block a paying customer.
    console.error("[rate-limit] check failed (allowing)", err);
    return { allowed: true, retryAfterMs: 0 };
  }
}

/** Test-only / maintenance: clear all counters. Best-effort. */
export async function __resetRateLimit(): Promise<void> {
  try {
    await db.delete(rateLimit);
  } catch (err) {
    console.error("[rate-limit] reset failed", err);
  }
}

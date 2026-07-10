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
          //
          // DRIVER TRAP: `windowStart` below goes through Drizzle's typed column
          // mapper, which stringifies a Date via `.toISOString()` before handing
          // it to the neon-http driver as a parameter — Postgres then casts that
          // UTC string straight into the (timezone-less) `timestamp` column. But
          // a raw JS `Date` interpolated directly into a `sql\`...\`` template
          // (as `${windowStartDate}` used to be here) is serialized by the
          // neon-http driver using the *local* wall-clock offset, not UTC. On a
          // box whose local TZ isn't UTC, that produced different digits than
          // what the typed `.values()` insert had just written for the exact
          // same instant, so `windowStart = param` was never true — every hit
          // looked like a new window and the counter reset to 1 forever. Fix:
          // hand the raw-sql side the same `.toISOString()` string the typed
          // path uses (not the Date object), with an explicit cast so Postgres
          // parses it identically (ignoring the trailing `Z`, per timestamp
          // literal parsing rules) instead of letting the driver reinterpret it.
          count: sql`CASE WHEN ${rateLimit.windowStart} = ${windowStartDate.toISOString()}::timestamp THEN ${rateLimit.count} + 1 ELSE 1 END`,
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

/**
 * Purge fixed-window rows whose window closed long ago, so the table doesn't
 * grow unbounded (one row per distinct limiter key ever seen). Run from the
 * daily health cron — see lib/alerts-sync.ts.
 *
 * Pure SQL-side interval, no JS `Date` parameter: per the driver trap
 * documented above `checkRateLimit`, a raw `Date` interpolated into a `sql`
 * template is serialized using the *local* wall-clock offset by the
 * neon-http driver, which would make this comparison wrong on any box whose
 * local TZ isn't UTC. `now() - interval '24 hours'` is computed entirely in
 * Postgres, so there's no client-side Date to get that wrong.
 */
export async function purgeStaleRateLimitRows(): Promise<number> {
  try {
    const deleted = await db
      .delete(rateLimit)
      .where(sql`${rateLimit.windowStart} < now() - interval '24 hours'`)
      .returning({ key: rateLimit.key });
    return deleted.length;
  } catch (err) {
    console.error("[rate-limit] purge failed", err);
    return 0;
  }
}

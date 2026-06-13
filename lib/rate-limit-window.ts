// Pure, IO-free fixed-window rate-limit math. Kept separate from lib/rate-limit.ts
// (the DB-backed IO layer) so the unit tests can import it WITHOUT transitively
// pulling in lib/db — same convention the rest of the tested modules follow.

export type RateLimitOpts = { limit: number; windowMs: number };
export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

/**
 * Floor `now` to the start of its fixed window. All hits between
 * `[windowStart, windowStart + windowMs)` share one counter, which resets the
 * instant the window rolls over.
 */
export function computeWindowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

/**
 * Decide from a post-increment counter whether the hit is allowed. `count` is
 * the count AFTER recording this hit (so the first hit in a window is 1); the
 * hit is allowed while the running count stays at or under `limit`. When
 * blocked, `retryAfterMs` is the time until the current window rolls over.
 */
export function decide(
  count: number,
  limit: number,
  windowStart: number,
  windowMs: number,
  now: number,
): RateLimitResult {
  if (count <= limit) return { allowed: true, retryAfterMs: 0 };
  return { allowed: false, retryAfterMs: windowStart + windowMs - now };
}

// In-memory sliding-window rate limiter. Per-process only — adequate as a first
// abuse cut; replace the `hits` store with Redis/Upstash for multi-instance.

type Opts = { limit: number; windowMs: number; now?: number };
type Result = { allowed: boolean; retryAfterMs: number };

const hits = new Map<string, number[]>();

export function checkRateLimit(key: string, opts: Opts): Result {
  const now = opts.now ?? Date.now();
  const cutoff = now - opts.windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= opts.limit) {
    const retryAfterMs = recent[0] + opts.windowMs - now;
    hits.set(key, recent);
    return { allowed: false, retryAfterMs };
  }

  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, retryAfterMs: 0 };
}

/** Test-only: clear all counters. */
export function __resetRateLimit() {
  hits.clear();
}

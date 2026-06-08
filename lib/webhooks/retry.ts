// Webhook retry backoff. `attempts` = number of attempts already made (>=1).
// Returns ms until the next retry, or null once the cap is reached.
const SCHEDULE_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 24 * 3_600_000];

export const MAX_ATTEMPTS = SCHEDULE_MS.length + 1; // initial attempt + 6 retries

export function nextBackoff(attempts: number): number | null {
  const idx = attempts - 1;
  return idx >= 0 && idx < SCHEDULE_MS.length ? SCHEDULE_MS[idx] : null;
}

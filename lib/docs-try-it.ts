// Client-safe helpers for the docs Try it console (no spec import, so the
// browser bundle stays small).
export const EXAMPLE_IDEMPOTENCY_KEY = "0b6f3c2a-8d4e-4f1a-9e7b-1c2d3e4f5a6b";

/** The Try it console pre-fills Idempotency-Key with the spec's example, so
 * every Send reused one key and the API replayed the first response (same
 * cmd id, no new QR). Swap the placeholder for a fresh key per request; a key
 * the visitor typed themselves is left alone so replays can still be tried. */
export function freshIdempotencyKey(headers: Headers, newKey: () => string): void {
  if (headers.get("idempotency-key") === EXAMPLE_IDEMPOTENCY_KEY) {
    headers.set("idempotency-key", newKey());
  }
}

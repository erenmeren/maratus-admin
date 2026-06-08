// Stripe-style webhook signature: HMAC-SHA256 over "<timestamp>.<payload>".
// Subscribers recompute with their endpoint secret to verify authenticity.
import { createHmac } from "node:crypto";

export function signPayload(payload: string, secret: string, timestampSec: number): string {
  const mac = createHmac("sha256", secret).update(`${timestampSec}.${payload}`).digest("hex");
  return `t=${timestampSec},v1=${mac}`;
}

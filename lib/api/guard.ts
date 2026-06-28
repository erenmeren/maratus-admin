// Shared preamble for /api/v1 routes: bearer auth → rate limit → suspension.
// Returns the resolved auth or a ready-to-send error NextResponse.
import { NextResponse } from "next/server";
import { authenticateApiKey, type ApiKeyAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { isOrgPaymentBlocked } from "@/lib/billing/enforcement";
import { apiError } from "@/lib/api/respond";

export async function guardApiRequest(
  req: Request,
): Promise<{ auth: ApiKeyAuth } | { error: NextResponse }> {
  const auth = await authenticateApiKey(req);
  if (!auth) return { error: apiError("unauthorized", "Missing or invalid API key.", 401) };

  const rl = await checkRateLimit(auth.keyHash, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) {
    const res = apiError("rate_limited", "Too many requests.", 429);
    res.headers.set("Retry-After", String(Math.ceil(rl.retryAfterMs / 1000)));
    return { error: res };
  }

  const block = await isOrgPaymentBlocked(auth.organizationId);
  if (block.blocked) {
    return block.reason === "past_due"
      ? { error: apiError("payment_past_due", "Account past due.", 402) }
      : { error: apiError("subscription_inactive", "Subscription inactive.", 403) };
  }

  return { auth };
}

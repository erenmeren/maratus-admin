// Shared preamble for /api/v1 routes: bearer auth → rate limit → suspension.
// Returns the resolved auth or a ready-to-send error NextResponse.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { authenticateApiKey, type ApiKeyAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { isSuspended } from "@/lib/billing/billing-status";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { apiError } from "@/lib/api/respond";

export async function guardApiRequest(
  req: Request,
): Promise<{ auth: ApiKeyAuth } | { error: NextResponse }> {
  const auth = await authenticateApiKey(req);
  if (!auth) return { error: apiError("unauthorized", "Missing or invalid API key.", 401) };

  const rl = checkRateLimit(auth.keyHash, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) {
    const res = apiError("rate_limited", "Too many requests.", 429);
    res.headers.set("Retry-After", String(Math.ceil(rl.retryAfterMs / 1000)));
    return { error: res };
  }

  const [billing] = await db
    .select({ status: tenantSettings.subscriptionStatus })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, auth.organizationId))
    .limit(1);
  if (isSuspended(billing?.status ?? null)) {
    return { error: apiError("subscription_inactive", "Subscription inactive.", 403) };
  }

  return { auth };
}

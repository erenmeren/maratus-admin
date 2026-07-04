// Shared preamble for /api/v1 routes: bearer auth → rate limit.
// Returns the resolved auth or a ready-to-send error NextResponse.
import { NextResponse } from "next/server";
import { authenticateApiKey, type ApiKeyAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
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

  return { auth };
}

// Shared preamble for /api/v1 routes: bearer auth → rate limit.
// Returns the resolved auth or a ready-to-send error NextResponse.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { authenticateApiKey, type ApiKeyAuth } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/api/respond";
import { db } from "@/lib/db";
import { apiKey as apiKeyTable } from "@/lib/db/schema";
import { hasScope, type ApiScope } from "@/lib/api-scopes";

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

/** 403 unless the authenticated key carries `scope`; null when it does. One
 *  place for the check so a new route cannot forget it. */
export async function requireScope(auth: ApiKeyAuth, scope: ApiScope): Promise<NextResponse | null> {
  const [key] = await db.select({ scopes: apiKeyTable.scopes }).from(apiKeyTable).where(eq(apiKeyTable.id, auth.keyId)).limit(1);
  if (hasScope(key?.scopes, scope)) return null;
  return apiError("insufficient_scope", `API key lacks the ${scope} scope.`, 403);
}

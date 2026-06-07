import { authenticateApiKey } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { isSuspended } from "@/lib/billing/billing-status";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { parseListParams } from "@/lib/api/params";
import { decodeCursor, encodeCursor } from "@/lib/api/cursor";
import { serializeReceiptRow } from "@/lib/api/serialize";
import { apiError, apiJson } from "@/lib/api/respond";
import { listReceiptsByCursor } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (!auth) return apiError("unauthorized", "Missing or invalid API key.", 401);

  const rl = checkRateLimit(auth.keyHash, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return apiError("rate_limited", "Too many requests.", 429);

  const [billing] = await db
    .select({ status: tenantSettings.subscriptionStatus })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, auth.organizationId))
    .limit(1);
  if (isSuspended(billing?.status ?? null)) return apiError("subscription_inactive", "Subscription inactive.", 403);

  const url = new URL(req.url);
  const parsed = parseListParams(url.searchParams);
  if (!parsed.ok) return apiError("invalid_param", parsed.error, 400);

  let cursor: { t: Date; id: string } | undefined;
  const cursorParam = url.searchParams.get("cursor");
  if (cursorParam) {
    const c = decodeCursor(cursorParam);
    if (!c) return apiError("invalid_cursor", "Malformed cursor.", 400);
    cursor = { t: new Date(c.t), id: c.id };
  }

  const limit = parsed.value.limit;
  const rows = await listReceiptsByCursor({
    organizationId: auth.organizationId,
    storeId: parsed.value.storeId,
    deviceId: parsed.value.deviceId,
    status: parsed.value.status,
    createdAfter: parsed.value.createdAfter,
    createdBefore: parsed.value.createdBefore,
    token: parsed.value.token,
    limit: limit + 1,
    cursor,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null;

  return apiJson({ data: page.map(serializeReceiptRow), next_cursor: nextCursor });
}

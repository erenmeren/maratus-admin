import { guardApiRequest } from "@/lib/api/guard";
import { parseListParams } from "@/lib/api/params";
import { decodeCursor, encodeCursor } from "@/lib/api/cursor";
import { serializeDocumentRow } from "@/lib/api/serialize";
import { apiError, apiJson } from "@/lib/api/respond";
import { listDocumentsByCursor } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const guard = await guardApiRequest(req);
  if ("error" in guard) return guard.error;
  const { auth } = guard;

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
  const rows = await listDocumentsByCursor({
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

  return apiJson({ data: page.map(serializeDocumentRow), next_cursor: nextCursor });
}

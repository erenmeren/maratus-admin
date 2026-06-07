import { authenticateApiKey } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { serializeReceiptDetail } from "@/lib/api/serialize";
import { apiError, apiJson } from "@/lib/api/respond";
import { getReceiptDetail } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(req);
  if (!auth) return apiError("unauthorized", "Missing or invalid API key.", 401);

  const rl = checkRateLimit(auth.keyHash, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return apiError("rate_limited", "Too many requests.", 429);

  const { id } = await params;
  const detail = await getReceiptDetail(id, { organizationId: auth.organizationId });
  if (!detail) return apiError("not_found", "Receipt not found.", 404);

  return apiJson(serializeReceiptDetail(detail));
}

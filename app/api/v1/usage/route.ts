import { authenticateApiKey } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { serializeUsage } from "@/lib/api/serialize";
import { apiError, apiJson } from "@/lib/api/respond";
import { getApiUsage } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (!auth) return apiError("unauthorized", "Missing or invalid API key.", 401);

  const rl = checkRateLimit(auth.keyHash, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return apiError("rate_limited", "Too many requests.", 429);

  const usage = await getApiUsage(auth.organizationId);
  return apiJson(serializeUsage(usage));
}

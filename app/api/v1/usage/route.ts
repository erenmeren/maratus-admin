import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKey as apiKeyTable } from "@/lib/db/schema";
import { guardApiRequest } from "@/lib/api/guard";
import { serializeUsage } from "@/lib/api/serialize";
import { apiError, apiJson } from "@/lib/api/respond";
import { hasScope } from "@/lib/api-scopes";
import { getApiUsage } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const guard = await guardApiRequest(req);
  if ("error" in guard) return guard.error;
  const { auth } = guard;

  const [key] = await db.select({ scopes: apiKeyTable.scopes }).from(apiKeyTable).where(eq(apiKeyTable.id, auth.keyId)).limit(1);
  if (!hasScope(key?.scopes, "usage:read")) {
    return apiError("insufficient_scope", "API key lacks the usage:read scope.", 403);
  }

  const usage = await getApiUsage(auth.organizationId);
  return apiJson(serializeUsage(usage));
}

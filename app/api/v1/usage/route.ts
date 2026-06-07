import { guardApiRequest } from "@/lib/api/guard";
import { serializeUsage } from "@/lib/api/serialize";
import { apiJson } from "@/lib/api/respond";
import { getApiUsage } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const guard = await guardApiRequest(req);
  if ("error" in guard) return guard.error;
  const { auth } = guard;

  const usage = await getApiUsage(auth.organizationId);
  return apiJson(serializeUsage(usage));
}

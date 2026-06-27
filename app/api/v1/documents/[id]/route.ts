import { guardApiRequest } from "@/lib/api/guard";
import { serializeDocumentDetail } from "@/lib/api/serialize";
import { apiError, apiJson } from "@/lib/api/respond";
import { getDocumentDetail } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApiRequest(req);
  if ("error" in guard) return guard.error;
  const { auth } = guard;

  const { id } = await params;
  const detail = await getDocumentDetail(id, { organizationId: auth.organizationId });
  if (!detail) return apiError("not_found", "Document not found.", 404);

  return apiJson(serializeDocumentDetail(detail));
}

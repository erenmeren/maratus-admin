import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/session";
import { getDocumentDetail } from "@/lib/data";
import { DocumentDetail } from "@/components/documents/document-detail";

export default async function AdminDocumentDetailPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  await requirePlatformAdmin();
  const { documentId } = await params;
  const document = await getDocumentDetail(documentId, {});
  if (!document) notFound();

  return (
    <div className="flex flex-col gap-6 p-6">
      <Link className="text-sm underline" href="/admin/documents">← Back to documents</Link>
      <h1 className="text-2xl font-semibold tracking-tight">Document</h1>
      <DocumentDetail document={document} />
    </div>
  );
}

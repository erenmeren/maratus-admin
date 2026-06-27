import { requirePlatformAdmin } from "@/lib/session";
import { searchDocuments, getTenants } from "@/lib/data";
import { parseDocumentFilters, documentPageCount } from "@/lib/documents-search";
import { DocumentFilters } from "@/components/documents/document-filters";
import { DocumentsTable } from "@/components/documents/documents-table";

export default async function AdminDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePlatformAdmin();
  const raw = await searchParams;
  const filters = parseDocumentFilters(raw);
  const [{ rows, total }, tenants] = await Promise.all([searchDocuments(filters), getTenants()]);
  const orgs = tenants.map((t) => ({ id: t.id, name: t.name }));
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(raw).filter(([k, v]) => k !== "page" && v)) as Record<string, string>,
  ).toString();

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
      <DocumentFilters orgs={orgs} />
      <DocumentsTable rows={rows} page={filters.page} pageCount={documentPageCount(total)} basePath="/admin/documents" query={query} />
    </div>
  );
}

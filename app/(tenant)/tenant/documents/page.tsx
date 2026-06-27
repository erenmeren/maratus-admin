import { requireTenant } from "@/lib/session";
import { searchDocuments, getDocumentFilterOptions } from "@/lib/data";
import { parseDocumentFilters, documentPageCount } from "@/lib/documents-search";
import { DocumentFilters } from "@/components/documents/document-filters";
import { DocumentsTable } from "@/components/documents/documents-table";

export default async function TenantDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { organizationId } = await requireTenant();
  const raw = await searchParams;
  const filters = parseDocumentFilters({ ...raw, org: organizationId });
  const [{ rows, total }, options] = await Promise.all([
    searchDocuments({ ...filters, organizationId }),
    getDocumentFilterOptions(organizationId),
  ]);
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(raw).filter(([k, v]) => k !== "page" && v)) as Record<string, string>,
  ).toString();

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
      <DocumentFilters stores={options.stores} devices={options.devices} />
      <DocumentsTable rows={rows} page={filters.page} pageCount={documentPageCount(total)} basePath="/tenant/documents" query={query} />
    </div>
  );
}

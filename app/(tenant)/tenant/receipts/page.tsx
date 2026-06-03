import { requireTenant } from "@/lib/session";
import { searchReceipts, getReceiptFilterOptions } from "@/lib/data";
import { parseReceiptFilters, receiptPageCount } from "@/lib/receipts-search";
import { ReceiptFilters } from "@/components/receipts/receipt-filters";
import { ReceiptsTable } from "@/components/receipts/receipts-table";

export default async function TenantReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { organizationId } = await requireTenant();
  const raw = await searchParams;
  const filters = parseReceiptFilters({ ...raw, org: organizationId });
  const [{ rows, total }, options] = await Promise.all([
    searchReceipts({ ...filters, organizationId }),
    getReceiptFilterOptions(organizationId),
  ]);
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(raw).filter(([k, v]) => k !== "page" && v)) as Record<string, string>,
  ).toString();

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Receipts</h1>
      <ReceiptFilters stores={options.stores} devices={options.devices} />
      <ReceiptsTable rows={rows} page={filters.page} pageCount={receiptPageCount(total)} basePath="/tenant/receipts" query={query} />
    </div>
  );
}

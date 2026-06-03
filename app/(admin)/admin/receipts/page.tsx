import { requirePlatformAdmin } from "@/lib/session";
import { searchReceipts, getTenants } from "@/lib/data";
import { parseReceiptFilters, receiptPageCount } from "@/lib/receipts-search";
import { ReceiptFilters } from "@/components/receipts/receipt-filters";
import { ReceiptsTable } from "@/components/receipts/receipts-table";

export default async function AdminReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePlatformAdmin();
  const raw = await searchParams;
  const filters = parseReceiptFilters(raw);
  const [{ rows, total }, tenants] = await Promise.all([searchReceipts(filters), getTenants()]);
  const orgs = tenants.map((t) => ({ id: t.id, name: t.name }));
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(raw).filter(([k, v]) => k !== "page" && v)) as Record<string, string>,
  ).toString();

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Receipts</h1>
      <ReceiptFilters orgs={orgs} />
      <ReceiptsTable rows={rows} page={filters.page} pageCount={receiptPageCount(total)} basePath="/admin/receipts" query={query} />
    </div>
  );
}

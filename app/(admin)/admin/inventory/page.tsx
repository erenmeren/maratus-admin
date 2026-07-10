import { Boxes } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { InventoryTable } from "@/components/inventory/inventory-table";
import { getFactoryDevicePage, getFactoryStatusCounts } from "@/lib/factory-registry";
import type { RegistryStatus } from "@/lib/provisioning";
import { db } from "@/lib/db";
import { organization, store } from "@/lib/db/schema";

const REGISTRY_STATUSES: RegistryStatus[] = [
  "manufactured", "allocated", "claimed", "rma", "retired",
];

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const raw = await searchParams;
  const requestedPage = Math.max(1, Number(raw.page) || 1);
  const status: RegistryStatus | "all" =
    raw.status && (REGISTRY_STATUSES as string[]).includes(raw.status)
      ? (raw.status as RegistryStatus)
      : "all";
  const batch = raw.batch ?? "";

  const [devicePage, counts, customers, stores] = await Promise.all([
    getFactoryDevicePage({ page: requestedPage, status, batch }),
    getFactoryStatusCounts(),
    db.select({ id: organization.id, name: organization.name }).from(organization),
    db
      .select({ id: store.id, name: store.name, organizationId: store.organizationId })
      .from(store),
  ]);

  const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Every manufactured device, from factory floor to claim."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total serials" value={String(totalAll)} icon={Boxes} />
        <KpiCard label="Manufactured" value={String(counts.manufactured)} hint="in stock" />
        <KpiCard label="Allocated" value={String(counts.allocated)} hint="awaiting install" />
        <KpiCard label="Claimed" value={String(counts.claimed)} hint="live in the field" />
      </div>

      <InventoryTable
        rows={devicePage.rows}
        customers={customers}
        stores={stores}
        page={devicePage.page}
        pageCount={devicePage.pageCount}
        total={devicePage.total}
        status={status}
        batch={batch}
      />
    </>
  );
}

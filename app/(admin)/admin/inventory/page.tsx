import { Boxes } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { InventoryTable } from "@/components/inventory/inventory-table";
import { eq, isNull } from "drizzle-orm";
import { getFactoryDevicePage, getFactoryStatusCounts } from "@/lib/factory-registry";
import type { RegistryStatus } from "@/lib/provisioning";
import { db } from "@/lib/db";
import { organization, store, tenantSettings } from "@/lib/db/schema";

const REGISTRY_STATUSES: RegistryStatus[] = [
  "manufactured", "allocated", "claimed", "rma", "retired",
];

// Next delivers repeated query params (e.g. `?batch=a&batch=b`) as an array,
// not a single string — normalize first-value-wins before any `.trim()`/
// `.includes()` call downstream, or a repeated param 500s the page.
const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const rawPage = first(raw.page);
  const rawStatus = first(raw.status);
  const rawBatch = first(raw.batch);
  const requestedPage = Math.max(1, Number(rawPage) || 1);
  const status: RegistryStatus | "all" =
    rawStatus && (REGISTRY_STATUSES as string[]).includes(rawStatus)
      ? (rawStatus as RegistryStatus)
      : "all";
  const batch = rawBatch ?? "";

  const [devicePage, counts, customers, stores] = await Promise.all([
    getFactoryDevicePage({ page: requestedPage, status, batch }),
    getFactoryStatusCounts(),
    // Archived orgs must not be allocation targets (would re-arm zero-touch
    // auto-claim for an offboarded customer) — exclude them from the picker,
    // mirroring the loadAllOrgs left-join+filter pattern in lib/data.ts.
    db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .leftJoin(tenantSettings, eq(tenantSettings.organizationId, organization.id))
      .where(isNull(tenantSettings.archivedAt)),
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

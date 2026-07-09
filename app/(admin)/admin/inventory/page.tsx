import { Boxes } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { InventoryTable } from "@/components/inventory/inventory-table";
import { getFactoryDevices } from "@/lib/factory-registry";
import { getTenants } from "@/lib/data";
import { db } from "@/lib/db";
import { store } from "@/lib/db/schema";

export default async function InventoryPage() {
  const rows = await getFactoryDevices();
  const customers = (await getTenants()).map((t) => ({ id: t.id, name: t.name }));
  const stores = await db
    .select({ id: store.id, name: store.name, organizationId: store.organizationId })
    .from(store);

  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Every manufactured device, from factory floor to claim."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total serials" value={String(rows.length)} icon={Boxes} />
        <KpiCard label="Manufactured" value={String(count("manufactured"))} hint="in stock" />
        <KpiCard label="Allocated" value={String(count("allocated"))} hint="awaiting install" />
        <KpiCard label="Claimed" value={String(count("claimed"))} hint="live in the field" />
      </div>

      <InventoryTable rows={rows} customers={customers} stores={stores} />
    </>
  );
}

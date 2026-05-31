import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Cpu, MapPin, Receipt, ReceiptText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DeviceCard } from "@/components/device-card";
import { StatusBadge } from "@/components/status-badge";
import { getStore } from "@/lib/data";
import { requireTenant } from "@/lib/session";
import { formatNumber } from "@/lib/format";

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const { organizationId } = await requireTenant();
  const result = await getStore(storeId);
  if (!result || result.tenant.id !== organizationId) notFound();

  const { store } = result;
  const online = store.devices.filter((d) => d.status === "online").length;
  const receiptsToday = store.devices.reduce((a, d) => a + d.receiptsToday, 0);
  const receiptsMonth = store.devices.reduce(
    (a, d) => a + d.receiptsThisMonth,
    0,
  );
  const rollup = online
    ? "online"
    : store.devices.some((d) => d.status === "paused")
      ? "paused"
      : "offline";

  return (
    <>
      <Link
        href="/tenant/stores"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Stores
      </Link>

      <PageHeader title={store.name}>
        <StatusBadge status={rollup} />
      </PageHeader>
      <p className="-mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
        <MapPin className="size-3.5" />
        {store.address}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Kiosks"
          value={`${online}/${store.devices.length}`}
          hint="online"
          icon={Cpu}
        />
        <KpiCard
          label="Receipts today"
          value={formatNumber(receiptsToday)}
          icon={Receipt}
        />
        <KpiCard
          label="Receipts this month"
          value={formatNumber(receiptsMonth)}
          icon={ReceiptText}
        />
        <KpiCard
          label="Avg / kiosk"
          value={formatNumber(Math.round(receiptsMonth / store.devices.length))}
          hint="receipts this month"
        />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          Kiosks in this store
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {store.devices.map((d) => (
            <DeviceCard key={d.id} device={d} />
          ))}
        </div>
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  Clock,
  Cpu,
  MapPin,
  Receipt,
  ReceiptText,
  Router,
  TrendingUp,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DeviceCard } from "@/components/device-card";
import { StatusBadge } from "@/components/status-badge";
import { ClaimDeviceDialog } from "@/components/claim-device-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getStoreAnalytics, getUnclaimedDevices } from "@/lib/data";
import { requireTenant } from "@/lib/session";
import { ReceiptsAreaChart } from "@/components/charts";
import { PeakHeatmap } from "@/components/peak-heatmap";
import { StoreEditButton } from "@/components/store-edit-button";
import { formatCurrency, formatNumber } from "@/lib/format";

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const { ctx, organizationId } = await requireTenant();
  const result = await getStoreAnalytics(storeId);
  if (!result || result.store.tenantId !== organizationId) notFound();

  const { store, analytics } = result;
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  const canClaim = !!membership && ["owner", "admin"].includes(membership.role);
  const unclaimed = canClaim ? await getUnclaimedDevices(organizationId) : [];

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
  const avgPerKiosk = store.devices.length
    ? Math.round(receiptsMonth / store.devices.length)
    : 0;

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
        {canClaim && (
          <StoreEditButton
            store={{
              id: store.id,
              name: store.name,
              address: store.address,
              timezone: store.timezone,
            }}
          />
        )}
        {canClaim && <ClaimDeviceDialog storeId={store.id} />}
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
          value={formatNumber(avgPerKiosk)}
          hint="receipts this month"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Receipts this month"
          value={formatNumber(analytics.monthTrend.current)}
          delta={analytics.monthTrend.pctChange ?? undefined}
          hint="vs last month"
          icon={TrendingUp}
        />
        <KpiCard
          label="Revenue this month"
          value={formatCurrency(analytics.revenueThisMonth)}
          icon={Receipt}
        />
        <KpiCard
          label="Paper saved"
          value={`${analytics.eco.paperKg.toFixed(1)} kg`}
          hint="this month"
        />
        <KpiCard
          label="Busiest day"
          value={analytics.peak.busiestDowLabel ?? "—"}
          hint="last 90 days"
          icon={CalendarClock}
        />
        <KpiCard
          label="Peak hour"
          value={analytics.peak.peakHourLabel ?? "—"}
          hint="last 90 days"
          icon={Clock}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Receipts over time</CardTitle>
          <CardDescription>Daily digital receipts, last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <ReceiptsAreaChart data={analytics.daily} height={260} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Busiest times</CardTitle>
          <CardDescription>
            Receipts by day of week and hour, last 90 days
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PeakHeatmap heatmap={analytics.heatmap} timezone={store.timezone} />
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
          Kiosks in this store
        </h2>
        {store.devices.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {store.devices.map((d) => (
              <DeviceCard key={d.id} device={d} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Cpu className="size-6" />
              </span>
              <p className="text-sm font-medium">No kiosks here yet</p>
              {canClaim && (
                <p className="max-w-xs text-xs text-muted-foreground">
                  Claim a kiosk with its pairing code to start issuing digital
                  receipts at this store.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Devices awaiting provisioning for this account */}
      {canClaim && unclaimed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Router className="size-4 text-muted-foreground" />
              Unclaimed kiosks
            </CardTitle>
            <CardDescription>
              {unclaimed.length} device{unclaimed.length > 1 ? "s" : ""} waiting
              to be provisioned. Use a pairing code with “Claim kiosk” above.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {unclaimed.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2"
              >
                <span className="text-sm font-medium">{d.name}</span>
                <code className="rounded bg-background px-2 py-0.5 font-mono text-xs tracking-[0.14em]">
                  {d.pairingCode}
                </code>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

import Link from "next/link";
import { ArrowUpRight, CalendarDays, Cpu, FileText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { EcoSavingsCard } from "@/components/eco-savings";
import { DocumentsAreaChart } from "@/components/charts";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle,  } from "@/components/ui/card";
import { getTenantDashboard, getTenantStores } from "@/lib/data";
import { requireTenant } from "@/lib/session";
import { formatNumber } from "@/lib/format";

export default async function TenantDashboardPage() {
  const { organizationId } = await requireTenant();
  const dash = await getTenantDashboard(organizationId);
  const stores = await getTenantStores(organizationId);
  const topStores = [...stores]
    .sort((a, b) => b.activationsThisMonth - a.activationsThisMonth)
    .slice(0, 4);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${dash.tenant.contact.name.split(" ")[0]}`}
        description={`Here's how ${dash.tenant.name}'s paperless checkout is doing today.`}
      >
        <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs text-muted-foreground">
          <CalendarDays className="size-3.5" />
          May 30, 2026
        </span>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Activations today"
          value={formatNumber(dash.activationsToday)}
          delta={6.4}
          hint="vs. yesterday"
          icon={FileText}
        />
        <KpiCard
          label="Activations this month"
          value={formatNumber(dash.activationsThisMonth)}
          delta={12.1}
          hint="vs. last month"
          icon={FileText}
        />
        <KpiCard
          label="Active devices"
          value={`${dash.activeDevices}/${dash.totalDevices}`}
          hint="printers online now"
          icon={Cpu}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Documents over time</CardTitle>
            <CardDescription>Daily activations, last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <DocumentsAreaChart data={dash.daily} />
          </CardContent>
        </Card>

        <EcoSavingsCard eco={dash.eco} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle>Busiest stores</CardTitle>
            <CardDescription>Documents this month, by branch</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/tenant/stores">
              All stores
              <ArrowUpRight className="size-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {topStores.map((s) => (
            <Link
              key={s.id}
              href={`/tenant/stores/${s.id}`}
              className="flex items-center justify-between rounded-xl border p-4 transition-colors hover:bg-accent/50"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{s.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.deviceCount} printers · {s.onlineCount} online
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className="font-display text-lg font-bold tabular-nums">
                  {formatNumber(s.activationsThisMonth)}
                </span>
                <StatusBadge status={s.status} />
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

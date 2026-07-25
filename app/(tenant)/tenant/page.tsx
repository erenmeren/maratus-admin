import { CalendarDays, Coins, Cpu, FileText, Pin, Wallet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { ActivationsAreaChart } from "@/components/charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantDashboard } from "@/lib/data";
import { requireTenant } from "@/lib/session";
import { formatNumber } from "@/lib/format";

export default async function TenantDashboardPage() {
  const { ctx, organizationId } = await requireTenant();
  const dash = await getTenantDashboard(organizationId);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${(ctx.user.name || dash.tenant.name).split(" ")[0]}`}
        description={`Here's how ${dash.tenant.name} is doing today.`}
      >
        <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs text-muted-foreground">
          <CalendarDays className="size-3.5" />
          {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </span>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Activations today"
          value={formatNumber(dash.activationsToday)}
          delta={dash.activationsTodayDeltaPct ?? undefined}
          hint={dash.activationsTodayDeltaPct !== null ? "vs. same time yesterday" : undefined}
          icon={FileText}
        />
        <KpiCard
          label="Activations this month"
          value={formatNumber(dash.activationsThisMonth)}
          delta={dash.activationsThisMonthDeltaPct ?? undefined}
          hint={dash.activationsThisMonthDeltaPct !== null ? "vs. last month to date" : undefined}
          icon={FileText}
        />
        <KpiCard
          label="Active devices"
          value={`${dash.activeDevices}/${dash.totalDevices}`}
          hint="screens online now"
          icon={Cpu}
        />
        <KpiCard
          label="Credits remaining"
          value={formatNumber(dash.creditsAvailable)}
          hint="available balance"
          icon={Wallet}
        />
        <KpiCard
          label="Credits used this month"
          value={formatNumber(dash.creditsUsedThisMonth)}
          hint="triggers + pin updates"
          icon={Coins}
        />
        <KpiCard
          label="Pin updates this month"
          value={formatNumber(dash.pinUpdatesThisMonth)}
          hint="applied by screens"
          icon={Pin}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activations over time</CardTitle>
          <CardDescription>Daily activations, last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivationsAreaChart data={dash.daily} />
        </CardContent>
      </Card>
    </>
  );
}

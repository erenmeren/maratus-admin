import { CalendarDays, Cpu, FileText, Pin } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard, KpiGroup } from "@/components/kpi-card";
import { ActivationsAreaChart } from "@/components/charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantDashboard } from "@/lib/data";
import { requireSection } from "@/lib/session";
import { formatNumber } from "@/lib/format";

export default async function TenantDashboardPage() {
  const { ctx, organizationId } = await requireSection("dashboard");
  const dash = await getTenantDashboard(organizationId);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${(ctx.user.name || dash.tenant.name).split(" ")[0]}`}
        description={`Here's how ${dash.tenant.name} is doing today.`}
      >
        <span className="glass-panel inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] whitespace-nowrap text-muted-foreground max-sm:self-start">
          <CalendarDays aria-hidden className="size-4 stroke-[1.6]" />
          {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </span>
      </PageHeader>

      <KpiGroup columns={4}>
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
          label="Pin updates this month"
          value={formatNumber(dash.pinUpdatesThisMonth)}
          hint="applied by screens"
          icon={Pin}
        />
      </KpiGroup>

      <Card>
        <CardHeader>
          <CardTitle>Activations over time</CardTitle>
          <CardDescription>Daily activations, last 30 days</CardDescription>
        </CardHeader>
        <CardContent className="pr-5 pl-3 max-md:pr-3 max-md:pl-1">
          <ActivationsAreaChart data={dash.daily} />
        </CardContent>
      </Card>
    </>
  );
}

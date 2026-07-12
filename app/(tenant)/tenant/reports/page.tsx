import { PageHeader } from "@/components/page-header";
import { ExportButton } from "@/components/export-button";
import {
  BreakdownBarChart,
  MetricAreaChart,
  DocumentsAreaChart,
} from "@/components/charts";
import { EcoSavingsCard } from "@/components/eco-savings";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getTenant, getTenantStoresPage, tenantMonthly } from "@/lib/data";
import { requireTenant } from "@/lib/session";
import { computeEcoSavings, PAPER_GRAMS_PER_DOCUMENT } from "@/lib/eco";
import { PAGE_SIZE } from "@/lib/list-params";

export default async function ReportsPage() {
  const { organizationId } = await requireTenant();
  const tenant = await getTenant(organizationId);
  const monthly = await tenantMonthly(organizationId);
  const { rows: stores, total: storeCount } = await getTenantStoresPage(organizationId, {
    q: "",
    page: 1,
    sort: "activations",
  });

  // Already sorted + capped to the first PAGE_SIZE (by activations) by the query above.
  const byStore = stores.map((s) => ({
    label: s.name.replace("Roastwell ", ""),
    value: s.activationsThisMonth,
  }));

  const byDevice = tenant.stores
    .flatMap((store) =>
      store.devices.map((d) => ({
        label: `${store.name.split(" ")[0]} · ${d.name}`,
        value: d.activationsThisMonth,
      })),
    )
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const ecoOverTime = monthly.map((p) => ({
    label: p.label,
    value: Math.round((p.activations * PAPER_GRAMS_PER_DOCUMENT) / 1000),
  }));

  const totalActivations = monthly.reduce((a, p) => a + p.activations, 0);
  const eco = computeEcoSavings(totalActivations);

  // Build a single CSV: a section per breakdown (monthly, by store, by device).
  const exportHeaders = ["Section", "Label", "Activations"];
  const exportRows: (string | number)[][] = [
    ...monthly.map((p) => ["Monthly", p.label, p.activations]),
    ...byStore.map((s) => ["By store", s.label, s.value]),
    ...byDevice.map((d) => ["By device", d.label, d.value]),
  ];

  return (
    <>
      <PageHeader
        title="Reports"
        description="Activations, breakdowns, and eco savings across your fleet."
      >
        <ExportButton
          label="Export report"
          filename={`${tenant.name.toLowerCase().replace(/\s+/g, "-")}-report.csv`}
          headers={exportHeaders}
          rows={exportRows}
        />
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Activations over time</CardTitle>
          <CardDescription>Monthly activations, last 9 months</CardDescription>
        </CardHeader>
        <CardContent>
          <DocumentsAreaChart data={monthly} height={300} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By store</CardTitle>
            <CardDescription>Activations this month, per branch</CardDescription>
          </CardHeader>
          <CardContent>
            <BreakdownBarChart data={byStore} />
            {storeCount > PAGE_SIZE && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing top {PAGE_SIZE} stores by activations.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By device</CardTitle>
            <CardDescription>Top printers by activations this month</CardDescription>
          </CardHeader>
          <CardContent>
            <BreakdownBarChart data={byDevice} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Eco savings over time</CardTitle>
            <CardDescription>Paper saved per month (kg)</CardDescription>
          </CardHeader>
          <CardContent>
            <MetricAreaChart data={ecoOverTime} unit="kg paper" height={260} />
          </CardContent>
        </Card>
        <EcoSavingsCard eco={eco} period="last 9 months" />
      </div>
    </>
  );
}

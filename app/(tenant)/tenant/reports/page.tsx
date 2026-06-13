import { PageHeader } from "@/components/page-header";
import { ExportButton } from "@/components/export-button";
import {
  BreakdownBarChart,
  MetricAreaChart,
  ReceiptsAreaChart,
} from "@/components/charts";
import { EcoSavingsCard } from "@/components/eco-savings";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getTenant, getTenantStores, tenantMonthly } from "@/lib/data";
import { requireTenant } from "@/lib/session";
import { computeEcoSavings, PAPER_GRAMS_PER_RECEIPT } from "@/lib/eco";

export default async function ReportsPage() {
  const { organizationId } = await requireTenant();
  const tenant = await getTenant(organizationId);
  const monthly = await tenantMonthly(organizationId);
  const stores = await getTenantStores(organizationId);

  const byStore = [...stores]
    .map((s) => ({ label: s.name.replace("Roastwell ", ""), value: s.receiptsThisMonth }))
    .sort((a, b) => b.value - a.value);

  const byDevice = tenant.stores
    .flatMap((store) =>
      store.devices.map((d) => ({
        label: `${store.name.split(" ")[0]} · ${d.name}`,
        value: d.receiptsThisMonth,
      })),
    )
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const ecoOverTime = monthly.map((p) => ({
    label: p.label,
    value: Math.round((p.receipts * PAPER_GRAMS_PER_RECEIPT) / 1000),
  }));

  const totalReceipts = monthly.reduce((a, p) => a + p.receipts, 0);
  const eco = computeEcoSavings(totalReceipts);

  // Build a single CSV: a section per breakdown (monthly, by store, by device).
  const exportHeaders = ["Section", "Label", "Receipts", "Revenue (USD)"];
  const exportRows: (string | number)[][] = [
    ...monthly.map((p) => ["Monthly", p.label, p.receipts, p.revenue.toFixed(2)]),
    ...byStore.map((s) => ["By store", s.label, s.value, ""]),
    ...byDevice.map((d) => ["By device", d.label, d.value, ""]),
  ];

  return (
    <>
      <PageHeader
        title="Reports"
        description="Receipts, breakdowns, and eco savings across your fleet."
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
          <CardTitle>Receipts over time</CardTitle>
          <CardDescription>Monthly digital receipts, last 9 months</CardDescription>
        </CardHeader>
        <CardContent>
          <ReceiptsAreaChart data={monthly} height={300} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By store</CardTitle>
            <CardDescription>Receipts this month, per branch</CardDescription>
          </CardHeader>
          <CardContent>
            <BreakdownBarChart data={byStore} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By device</CardTitle>
            <CardDescription>Top printers by receipts this month</CardDescription>
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

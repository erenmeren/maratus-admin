import { PageHeader } from "@/components/page-header";
import { ExportButton } from "@/components/export-button";
import { BreakdownBarChart, StoreCompareChart } from "@/components/charts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getStoresAnalytics } from "@/lib/data";
import { requireTenant } from "@/lib/session";
import { formatCurrency, formatNumber } from "@/lib/format";

export default async function AnalyticsPage() {
  const { organizationId } = await requireTenant();
  const { rows, monthlyByStore } = await getStoresAnalytics(organizationId);

  const byStore = rows.map((r) => ({ label: r.storeName, value: r.activationsThisMonth }));
  const exportHeaders = ["Store", "Activations (this month)", "Trend %", "Revenue (USD)", "Paper saved (kg)"];
  const exportRows = rows.map((r) => [
    r.storeName,
    r.activationsThisMonth,
    r.trend.pctChange === null ? "—" : r.trend.pctChange,
    r.revenueThisMonth.toFixed(2),
    r.eco.paperKg.toFixed(1),
  ]);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Compare activation volume, trends, and revenue across your stores."
      >
        <ExportButton
          label="Export analytics"
          filename="store-analytics.csv"
          headers={exportHeaders}
          rows={exportRows}
        />
      </PageHeader>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm font-medium">No store data yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Once your stores start showing QR codes, comparisons show up here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Activations by store</CardTitle>
              <CardDescription>This month, highest first</CardDescription>
            </CardHeader>
            <CardContent>
              <BreakdownBarChart data={byStore} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Store comparison</CardTitle>
              <CardDescription>This month vs last, per store</CardDescription>
            </CardHeader>
            <CardContent className="divide-y">
              {rows.map((r) => (
                <div key={r.storeId} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{r.storeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(r.activationsThisMonth)} activations · {formatCurrency(r.revenueThisMonth)}
                    </p>
                  </div>
                  <span
                    className={
                      r.trend.pctChange === null
                        ? "text-xs text-muted-foreground"
                        : r.trend.pctChange >= 0
                          ? "text-xs font-medium text-status-online"
                          : "text-xs font-medium text-destructive"
                    }
                  >
                    {r.trend.pctChange === null ? "new" : `${r.trend.pctChange >= 0 ? "▲" : "▼"} ${Math.abs(r.trend.pctChange)}%`}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trajectories</CardTitle>
              <CardDescription>Monthly activations per store, last 9 months</CardDescription>
            </CardHeader>
            <CardContent>
              <StoreCompareChart data={monthlyByStore} />
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}

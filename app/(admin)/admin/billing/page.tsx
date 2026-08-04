import Link from "next/link";
import { CircleDollarSign, Coins, Wallet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { ExportButton } from "@/components/export-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCreditsOverview, getPlanMix } from "@/lib/data";
import { formatNumber } from "@/lib/format";
import { PlanBadge, planLabel } from "@/components/billing/plan-badge";

export default async function BillingPage() {
  const [credits, mix] = await Promise.all([getCreditsOverview(), getPlanMix()]);

  const exportHeaders = ["Customer", "Plan", "Balance", "Consumed (mo.)", "Lifetime purchased"];
  const exportRows = credits.perTenant.map((t) => [
    t.name,
    planLabel(credits.planByOrg[t.orgId] ?? "credits"),
    t.balance,
    t.consumedThisMonth,
    t.lifetimePurchased,
  ]);

  return (
    <>
      <PageHeader
        title="Billing & Credits"
        description="Platform-wide prepaid credit sales, consumption, and per-tenant balances."
      >
        <ExportButton
          label="Export tenants"
          filename="ditto-credits.csv"
          headers={exportHeaders}
          rows={exportRows}
        />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Credits sold"
          value={formatNumber(credits.totals.purchased)}
          hint="lifetime, all tenants"
          icon={CircleDollarSign}
        />
        <KpiCard
          label="Credits consumed"
          value={formatNumber(credits.totals.consumed)}
          hint="lifetime, all tenants"
          icon={Coins}
        />
        <KpiCard
          label="Outstanding liability"
          value={formatNumber(credits.totals.outstanding)}
          hint="unspent credits owed to tenants"
          icon={Wallet}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Archived customers&apos; frozen credits are excluded from these totals.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Plan mix</CardTitle>
          <CardDescription>Active tenants per billing plan</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{mix.credits}</p>
            <p className="text-sm text-muted-foreground">Credits</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{mix.flat}</p>
            <p className="text-sm text-muted-foreground">Flat · {formatNumber(mix.flatDevices)} devices</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{mix.baseUsage}</p>
            <p className="text-sm text-muted-foreground">Base + usage · {formatNumber(mix.baseUsageDevices)} devices</p>
          </div>
        </CardContent>
      </Card>

      {/* Per-tenant credits */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Per-tenant credits</CardTitle>
          <CardDescription>Balance, consumption this month, and lifetime purchases</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Customer</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Consumed (mo.)</TableHead>
                <TableHead className="pr-6 text-right">Lifetime purchased</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {credits.perTenant.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={5}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    No tenants with credit activity yet.
                  </TableCell>
                </TableRow>
              )}
              {credits.perTenant.map((t) => (
                <TableRow key={t.orgId}>
                  <TableCell className="pl-6">
                    <Link
                      href={`/admin/customers/${t.orgId}`}
                      className="font-medium hover:underline"
                    >
                      {t.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <PlanBadge plan={credits.planByOrg[t.orgId] ?? "credits"} />
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatNumber(t.balance)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(t.consumedThisMonth)}
                  </TableCell>
                  <TableCell className="pr-6 text-right tabular-nums">
                    {formatNumber(t.lifetimePurchased)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

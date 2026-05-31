import Link from "next/link";
import { CircleDollarSign, Clock, Wallet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { ExportButton } from "@/components/export-button";
import { RevenueLineChart } from "@/components/charts";
import { TenantStatusBadge, InvoiceStatusBadge } from "@/components/tenant-status-badge";
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
import { getBillingOverview } from "@/lib/data";
import { formatCurrency, formatNumber } from "@/lib/format";

export default async function BillingPage() {
  const billing = await getBillingOverview();
  const mrr = billing.byTenant.reduce((a, t) => a + t.revenueThisMonth, 0);
  // org id → display name, for the invoice table
  const tenantNames = Object.fromEntries(
    billing.byTenant.map((t) => [t.id, t.name]),
  );

  return (
    <>
      <PageHeader
        title="Billing & Revenue"
        description="Per-customer pricing, invoices, and Ditto's earnings."
      >
        <ExportButton label="Export invoices" />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total earnings"
          value={formatCurrency(billing.totalEarnings, { cents: true })}
          hint="collected to date"
          icon={Wallet}
        />
        <KpiCard
          label="Current MRR"
          value={formatCurrency(mrr, { cents: true })}
          delta={9.2}
          hint="this month"
          icon={CircleDollarSign}
        />
        <KpiCard
          label="Outstanding"
          value={formatCurrency(billing.outstanding, { cents: true })}
          hint="due + overdue"
          icon={Clock}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue over time</CardTitle>
          <CardDescription>Platform-wide monthly revenue</CardDescription>
        </CardHeader>
        <CardContent>
          <RevenueLineChart data={billing.monthly} />
        </CardContent>
      </Card>

      {/* Per-customer pricing + amount owed */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Per-customer billing</CardTitle>
          <CardDescription>Pricing, monthly revenue, and balance owed</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Customer</TableHead>
                <TableHead className="text-right">Per print</TableHead>
                <TableHead className="text-right">Receipts (mo.)</TableHead>
                <TableHead className="text-right">Revenue (mo.)</TableHead>
                <TableHead className="text-right">Owed</TableHead>
                <TableHead className="pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billing.byTenant.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="pl-6">
                    <Link
                      href={`/admin/customers/${t.id}`}
                      className="font-medium hover:underline"
                    >
                      {t.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(t.perPrintPrice, { cents: true })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(t.receiptsThisMonth)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(t.revenueThisMonth, { cents: true })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.amountOwed > 0 ? (
                      <span className="font-medium text-foreground">
                        {formatCurrency(t.amountOwed, { cents: true })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-6">
                    <TenantStatusBadge status={t.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>Recent billing across all customers</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Receipts</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billing.invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="pl-6 font-mono text-xs">{inv.id}</TableCell>
                  <TableCell className="font-medium">
                    {tenantNames[inv.tenantId] ?? inv.tenantId}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{inv.period}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(inv.receipts)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(inv.amount, { cents: true })}
                  </TableCell>
                  <TableCell className="pr-6">
                    <InvoiceStatusBadge status={inv.status} />
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

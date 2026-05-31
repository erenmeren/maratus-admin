import Link from "next/link";
import { ArrowUpRight, Cpu, DollarSign, ReceiptText, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { ReceiptsAreaChart, RevenueLineChart } from "@/components/charts";
import { TenantStatusBadge } from "@/components/tenant-status-badge";
import { Button } from "@/components/ui/button";
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
import { getAdminOverview } from "@/lib/data";
import { formatCompact, formatCurrency, formatNumber } from "@/lib/format";

export default async function AdminOverviewPage() {
  const o = await getAdminOverview();

  return (
    <>
      <PageHeader
        title="Overview"
        description="Platform-wide performance across all Ditto customers."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="MRR"
          value={formatCurrency(o.mrr, { cents: true })}
          delta={9.2}
          hint="recurring"
          icon={DollarSign}
        />
        <KpiCard
          label="Receipts this month"
          value={formatCompact(o.receiptsThisMonth)}
          delta={12.1}
          hint="platform-wide"
          icon={ReceiptText}
        />
        <KpiCard
          label="Active devices"
          value={`${o.activeDevices}/${o.totalDevices}`}
          hint="kiosks online"
          icon={Cpu}
        />
        <KpiCard
          label="Customers"
          value={formatNumber(o.totalCustomers)}
          hint={`${o.totalStores} stores`}
          icon={Users}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue over time</CardTitle>
            <CardDescription>Monthly recurring revenue, all customers</CardDescription>
          </CardHeader>
          <CardContent>
            <RevenueLineChart data={o.monthly} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Receipts over time</CardTitle>
            <CardDescription>Monthly receipts, all customers</CardDescription>
          </CardHeader>
          <CardContent>
            <ReceiptsAreaChart data={o.monthly} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle>Top customers</CardTitle>
            <CardDescription>By revenue this month</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/customers">
              All customers
              <ArrowUpRight className="size-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Customer</TableHead>
                <TableHead className="text-center">Stores</TableHead>
                <TableHead className="text-center">Devices</TableHead>
                <TableHead className="text-right">Receipts</TableHead>
                <TableHead className="text-right pr-6">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {o.topCustomers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-6">
                    <Link
                      href={`/admin/customers/${c.id}`}
                      className="flex items-center gap-2 font-medium hover:underline"
                    >
                      {c.name}
                      <TenantStatusBadge status={c.status} />
                    </Link>
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {c.storeCount}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {c.deviceCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(c.receiptsThisMonth)}
                  </TableCell>
                  <TableCell className="text-right pr-6 font-medium tabular-nums">
                    {formatCurrency(c.revenueThisMonth, { cents: true })}
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

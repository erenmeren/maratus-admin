import Link from "next/link";
import { ArrowUpRight, Cpu, FileText, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { ActivationsAreaChart } from "@/components/charts";
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
import { getAdminOverview, getCreditUsageAllOrgs, currentMonthStart } from "@/lib/data";
import { formatCompact, formatNumber } from "@/lib/format";

export default async function AdminOverviewPage() {
  const [o, creditsByOrg] = await Promise.all([
    getAdminOverview(),
    getCreditUsageAllOrgs(currentMonthStart()),
  ]);

  return (
    <>
      <PageHeader
        title="Overview"
        description="Platform-wide performance across all Ditto customers."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Activations this month"
          value={formatCompact(o.activationsThisMonth)}
          delta={12.1}
          hint="platform-wide"
          icon={FileText}
        />
        <KpiCard
          label="Active devices"
          value={`${o.activeDevices}/${o.totalDevices}`}
          hint="screens online"
          icon={Cpu}
        />
        <KpiCard
          label="Customers"
          value={formatNumber(o.totalCustomers)}
          hint={`${o.totalStores} stores`}
          icon={Users}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activations over time</CardTitle>
          <CardDescription>Monthly activations, all customers</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivationsAreaChart data={o.monthly} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle>Top customers</CardTitle>
            <CardDescription>By activations this month</CardDescription>
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
                <TableHead className="text-right pr-6">Activations</TableHead>
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
                  <TableCell className="text-right pr-6 font-medium tabular-nums">
                    {formatNumber(c.activationsThisMonth)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Credits by company</CardTitle>
          <CardDescription>Trigger credits spent this month</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Company</TableHead>
                <TableHead className="text-right">Credits spent</TableHead>
                <TableHead className="text-right pr-6">Triggers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creditsByOrg.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="pl-6 text-muted-foreground">
                    No credit usage yet this month.
                  </TableCell>
                </TableRow>
              ) : (
                creditsByOrg.slice(0, 10).map((row) => (
                  <TableRow key={row.organizationId}>
                    <TableCell className="pl-6 font-medium">{row.name ?? row.organizationId}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(row.credits)}</TableCell>
                    <TableCell className="text-right pr-6 tabular-nums">{formatNumber(row.count)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

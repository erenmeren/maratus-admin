import Link from "next/link";
import { ArrowUpRight, Cpu, Zap, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard, KpiGroup } from "@/components/kpi-card";
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
import { getAdminOverview, getTriggerUsageAllOrgs, currentMonthStart } from "@/lib/data";
import { formatCompact, formatNumber } from "@/lib/format";

export default async function AdminOverviewPage() {
  const [o, triggersByOrg] = await Promise.all([
    getAdminOverview(),
    getTriggerUsageAllOrgs(currentMonthStart()),
  ]);

  return (
    <>
      <PageHeader
        title="Overview"
        description="Platform-wide performance across all Maratus customers."
      />

      <KpiGroup columns={3}>
        <KpiCard
          label="Activations this month"
          value={formatCompact(o.activationsThisMonth)}
          hint="platform-wide"
          icon={Zap}
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
      </KpiGroup>

      <Card>
        <CardHeader>
          <CardTitle>Activations over time</CardTitle>
          <CardDescription>Monthly activations, all customers</CardDescription>
        </CardHeader>
        <CardContent className="pr-5 pl-3 max-md:pr-3 max-md:pl-1">
          <ActivationsAreaChart data={o.monthly} />
        </CardContent>
      </Card>

      <Card className="gap-0 pb-0">
        <CardHeader className="flex items-center justify-between gap-4 pb-4">
          <div className="space-y-0.5">
            <CardTitle>Top customers</CardTitle>
            <CardDescription>By activations this month</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild className="-mr-2.5">
            <Link href="/admin/customers">
              All customers
              <ArrowUpRight className="size-4 stroke-[1.6]" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="border-t px-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Customer</TableHead>
                <TableHead className="text-center">Stores</TableHead>
                <TableHead className="text-center">Devices</TableHead>
                <TableHead className="text-right">Activations</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {o.topCustomers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="max-md:h-[60px] max-md:py-2.5 max-md:whitespace-normal">
                    <Link
                      href={`/admin/customers/${c.id}`}
                      className="inline-flex items-center gap-2.5 font-medium hover:underline max-md:flex-col max-md:items-start max-md:gap-0.5"
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
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatNumber(c.activationsThisMonth)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="gap-0 pb-0">
        <CardHeader className="gap-0.5 pb-4">
          <CardTitle>Triggers by company</CardTitle>
          <CardDescription>Acked triggers this month</CardDescription>
        </CardHeader>
        <CardContent className="border-t px-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Company</TableHead>
                <TableHead className="text-right">Triggers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {triggersByOrg.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-muted-foreground">
                    No trigger usage yet this month.
                  </TableCell>
                </TableRow>
              ) : (
                triggersByOrg.slice(0, 10).map((row) => (
                  <TableRow key={row.organizationId}>
                    <TableCell className="font-medium">{row.name ?? row.organizationId}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(row.triggers)}</TableCell>
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

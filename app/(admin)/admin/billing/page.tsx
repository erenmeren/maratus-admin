import Link from "next/link";
import { AlertTriangle, CircleDollarSign, FileText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { ExportButton } from "@/components/export-button";
import { Badge } from "@/components/ui/badge";
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
import { formatDate, formatNumber, formatUsdCents } from "@/lib/format";

type TenantRow = Awaited<ReturnType<typeof getBillingOverview>>["perTenant"][number];

const STATUS_UI: Record<
  "overdue" | "open" | "current",
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  overdue: { label: "Overdue", variant: "destructive" },
  open: { label: "Open", variant: "secondary" },
  current: { label: "Current", variant: "default" },
};

function tenantStatus(t: TenantRow): keyof typeof STATUS_UI {
  if (t.overdue) return "overdue";
  if (t.openUsdCents > 0) return "open";
  return "current";
}

export default async function BillingPage() {
  const billing = await getBillingOverview();

  const exportHeaders = ["Customer", "Paid devices", "Renews", "Open amount", "Status"];
  const exportRows = billing.perTenant.map((t) => [
    t.name,
    t.paidDevices,
    t.renewsAt ? formatDate(t.renewsAt) : "Not subscribed",
    formatUsdCents(t.openUsdCents),
    STATUS_UI[tenantStatus(t)].label,
  ]);

  return (
    <>
      <PageHeader
        title="Billing"
        description="Platform-wide subscription invoices — what customers owe and what has been collected."
      >
        <ExportButton
          label="Export tenants"
          filename="maratus-billing.csv"
          headers={exportHeaders}
          rows={exportRows}
        />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Open invoices"
          value={formatUsdCents(billing.totals.openUsdCents)}
          hint="unpaid, all tenants"
          icon={FileText}
        />
        <KpiCard
          label="Overdue"
          value={formatUsdCents(billing.totals.overdueUsdCents)}
          hint="open and past due date"
          icon={AlertTriangle}
        />
        <KpiCard
          label="Paid this year"
          value={formatUsdCents(billing.totals.paidThisYearUsdCents)}
          hint="collected since Jan 1"
          icon={CircleDollarSign}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {formatNumber(billing.totals.subscribedOrgs)} subscribed tenants ·{" "}
        {formatNumber(billing.totals.paidDevices)} paid devices. Archived customers are
        excluded from these totals.
      </p>

      {/* Per-tenant billing */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Per-tenant billing</CardTitle>
          <CardDescription>Paid devices, renewal date, and open balance</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Customer</TableHead>
                <TableHead className="text-right">Paid devices</TableHead>
                <TableHead>Renews</TableHead>
                <TableHead className="text-right">Open amount</TableHead>
                <TableHead className="pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billing.perTenant.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={5}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    No tenants yet.
                  </TableCell>
                </TableRow>
              )}
              {billing.perTenant.map((t) => {
                const statusUi = STATUS_UI[tenantStatus(t)];
                return (
                  <TableRow key={t.orgId}>
                    <TableCell className="pl-6">
                      <Link
                        href={`/admin/customers/${t.orgId}`}
                        className="font-medium hover:underline"
                      >
                        {t.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(t.paidDevices)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.renewsAt ? formatDate(t.renewsAt) : "Not subscribed"}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatUsdCents(t.openUsdCents)}
                    </TableCell>
                    <TableCell className="pr-6">
                      <Badge variant={statusUi.variant}>{statusUi.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

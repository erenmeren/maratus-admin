import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Cpu,
  DollarSign,
  Mail,
  Phone,
  ReceiptText,
  Store,
  Tag,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { RevenueLineChart, BreakdownBarChart } from "@/components/charts";
import { StatusDot } from "@/components/status-badge";
import { TenantStatusBadge } from "@/components/tenant-status-badge";
import { AddBranchDialog } from "@/components/add-branch-dialog";
import { ProvisionDeviceDialog } from "@/components/provision-device-dialog";
import { DeviceRowActions } from "@/components/device-row-actions";
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
import { getCustomerDetail, getOrgAuditLog, getCreditLedger } from "@/lib/data";
import { getBalance } from "@/lib/credits";
import { grantCreditsAction } from "@/lib/actions/credits";
import { formatCurrency, formatNumber, timeAgo } from "@/lib/format";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const detail = await getCustomerDetail(tenantId);
  if (!detail) notFound();

  const activity = await getOrgAuditLog(tenantId, 50);
  const [creditBalance, creditLedger] = await Promise.all([
    getBalance(tenantId),
    getCreditLedger(tenantId),
  ]);

  async function handleGrantCredits(formData: FormData): Promise<void> {
    "use server";
    await grantCreditsAction(formData);
  }

  const { tenant, summary, devices, monthly } = detail;
  const storeOptions = tenant.stores.map((s) => ({ id: s.id, name: s.name }));

  const byStore = tenant.stores
    .map((s) => ({
      label: s.name.replace(`${tenant.name} `, "").replace(`${tenant.logoText} — `, ""),
      value: s.devices.reduce((a, d) => a + d.receiptsThisMonth, 0),
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <Link
        href="/admin/customers"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Customers
      </Link>

      {/* Header card */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 font-display text-2xl font-bold text-primary">
              {tenant.name.slice(0, 1)}
            </span>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-bold tracking-tight">
                  {tenant.name}
                </h1>
                <TenantStatusBadge status={tenant.status} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Mail className="size-3.5" /> {tenant.contact.email}
                </span>
                <span className="flex items-center gap-1.5">
                  <Phone className="size-3.5" /> {tenant.contact.phone}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-4 py-3">
              <Tag className="size-4 text-primary" />
              <div>
                <p className="font-display text-xl font-bold tabular-nums">
                  {formatCurrency(tenant.perPrintPrice, { cents: true })}
                </p>
                <p className="text-xs text-muted-foreground">per print</p>
              </div>
            </div>
            <AddBranchDialog
              organizationId={tenant.id}
              customerName={tenant.name}
            />
          </div>
        </CardContent>
      </Card>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Stores" value={formatNumber(summary.storeCount)} icon={Store} />
        <KpiCard label="Devices" value={formatNumber(summary.deviceCount)} icon={Cpu} />
        <KpiCard
          label="Receipts this month"
          value={formatNumber(summary.receiptsThisMonth)}
          icon={ReceiptText}
        />
        <KpiCard
          label="Revenue this month"
          value={formatCurrency(summary.revenueThisMonth, { cents: true })}
          icon={DollarSign}
        />
      </div>

      {/* Print / revenue breakdown */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue over time</CardTitle>
            <CardDescription>Monthly revenue from this customer</CardDescription>
          </CardHeader>
          <CardContent>
            <RevenueLineChart data={monthly} height={240} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Receipts by store</CardTitle>
            <CardDescription>This month, per branch</CardDescription>
          </CardHeader>
          <CardContent>
            <BreakdownBarChart data={byStore} height={240} />
          </CardContent>
        </Card>
      </div>

      {/* Credits */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Credits</CardTitle>
          <CardDescription>
            Available:{" "}
            <span className="font-semibold tabular-nums">
              {formatNumber(creditBalance.available)}
            </span>{" "}
            &middot; Held:{" "}
            <span className="font-semibold tabular-nums">
              {formatNumber(creditBalance.held)}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            action={handleGrantCredits}
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="organizationId" value={tenantId} />
            <div className="flex flex-col gap-1">
              <label
                htmlFor="credits-amount"
                className="text-xs font-medium text-muted-foreground"
              >
                Credits
              </label>
              <input
                id="credits-amount"
                name="credits"
                type="number"
                min={1}
                max={1000000}
                step={1}
                required
                placeholder="e.g. 100"
                className="h-9 w-36 rounded-md border bg-background px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="credits-note"
                className="text-xs font-medium text-muted-foreground"
              >
                Note (optional)
              </label>
              <input
                id="credits-note"
                name="note"
                type="text"
                placeholder="e.g. promotional grant"
                className="h-9 w-56 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <button
              type="submit"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Grant credits
            </button>
          </form>

          {creditLedger.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-0">Kind</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditLedger.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-0 capitalize">{row.kind}</TableCell>
                    <TableCell className="tabular-nums">{formatNumber(row.credits)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.deviceId ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.note ?? "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {timeAgo(row.createdAt.toISOString())}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {creditLedger.length === 0 && (
            <p className="text-sm text-muted-foreground">No ledger entries yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Assigned devices */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle>Assigned devices</CardTitle>
            <CardDescription>{devices.length} printers across all stores</CardDescription>
          </div>
          <ProvisionDeviceDialog
            organizationId={tenant.id}
            customerName={tenant.name}
            stores={storeOptions}
          />
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Device</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="text-right">Receipts (mo.)</TableHead>
                <TableHead className="w-10 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="pl-6 font-mono text-xs">{d.id}</TableCell>
                  <TableCell>{d.storeName}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm capitalize">
                      <StatusDot status={d.status} />
                      {d.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {timeAgo(d.lastSeen)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatNumber(d.receiptsThisMonth)}
                  </TableCell>
                  <TableCell className="pr-4">
                    <DeviceRowActions deviceId={d.id} status={d.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Activity</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {activity.map((e) => (
              <li key={e.id} className="flex justify-between border-t py-1.5">
                <span>{e.action}</span>
                <span className="text-muted-foreground">
                  {e.actor} · {e.at.slice(0, 19).replace("T", " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

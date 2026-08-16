// app/(tenant)/tenant/billing/page.tsx
import { requireTenant } from "@/lib/session";
import { getTenantBillingOverview } from "@/lib/data";
import { isInvoiceOverdue, listInvoices } from "@/lib/invoices";
import { subscriptionAmountCents } from "@/lib/invoicing";
import { PageHeader } from "@/components/page-header";
import { InvoiceTable } from "@/components/billing/invoice-table";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate, formatNumber, formatUsdCents } from "@/lib/format";
import { BANK_DETAILS } from "@/lib/bank-details";

type SubscriptionStatus = "not_subscribed" | "active" | "overdue";

const STATUS_UI: Record<
  SubscriptionStatus,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  not_subscribed: { label: "Not subscribed", variant: "secondary" },
  active: { label: "Active", variant: "default" },
  overdue: { label: "Overdue", variant: "destructive" },
};

export default async function TenantBillingPage() {
  const { organizationId } = await requireTenant();
  const [overview, invoices] = await Promise.all([
    getTenantBillingOverview(organizationId),
    listInvoices(organizationId),
  ]);

  const now = new Date();
  // "Overdue" is derived, never stored — the rule lives in lib/invoices.ts.
  const hasOverdueInvoice = invoices.some((inv) => isInvoiceOverdue(inv, now));
  const status: SubscriptionStatus = !overview.subscribed
    ? "not_subscribed"
    : hasOverdueInvoice
      ? "overdue"
      : "active";
  const statusUi = STATUS_UI[status];
  // The entitlement for this contract year, not a live-occupancy snapshot —
  // it must not drop when an RMA frees a slot; the org already paid for the
  // full year. A renewal preview (a different question) is priced from live
  // occupancy at issuance time, in lib/billing-cron.ts.
  const annualAmountCents = subscriptionAmountCents(
    overview.paidDeviceSlots,
    overview.pricePerDeviceCents,
  );

  return (
    <>
      <PageHeader
        title="Billing"
        description="Your subscription, this period's usage, and invoices — settled by bank transfer."
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle>Subscription</CardTitle>
            <CardDescription>Annual, billed by bank transfer.</CardDescription>
          </div>
          <Badge variant={statusUi.variant}>{statusUi.label}</Badge>
        </CardHeader>
        <CardContent>
          {!overview.subscribed ? (
            <p className="text-sm text-muted-foreground">
              No subscription yet. Contact us to get started.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Started</p>
                <p className="font-medium">
                  {formatDate(overview.startedAt as Date)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Renews</p>
                <p className="font-medium">
                  {overview.renewsAt ? formatDate(overview.renewsAt) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Slots</p>
                <p className="flex items-center gap-2 font-medium tabular-nums">
                  {formatNumber(overview.paidDevices)} of{" "}
                  {formatNumber(overview.paidDeviceSlots)} in use
                  {overview.freeSlots > 0 && (
                    <Badge variant="secondary" className="tabular-nums">
                      {formatNumber(overview.freeSlots)} free
                    </Badge>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Annual amount</p>
                <p className="font-medium tabular-nums">
                  {formatUsdCents(annualAmountCents)}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>This period</CardTitle>
          <CardDescription>
            {overview.periodStart && overview.periodEnd
              ? `${formatDate(overview.periodStart)} – ${formatDate(overview.periodEnd)}`
              : "Starts once your subscription is active."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!overview.subscribed ? (
            <p className="text-sm text-muted-foreground">
              Trigger usage will appear here once your subscription starts.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-2xl font-semibold tabular-nums">
                {formatNumber(overview.used)}{" "}
                <span className="text-base font-normal text-muted-foreground">
                  / {formatNumber(overview.includedTotal)} triggers
                </span>
              </p>
              {overview.overageTriggers > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {formatNumber(overview.overageTriggers)} extra ×{" "}
                  {formatUsdCents(overview.overagePriceCents)} ={" "}
                  <span className="font-medium text-foreground">
                    {formatUsdCents(overview.estimatedOverageUsdCents)}
                  </span>{" "}
                  estimated
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Within your included quota.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <InvoiceTable invoices={invoices} isSubscribed={overview.subscribed} disabled />

      <Card>
        <CardHeader>
          <CardTitle>How to pay</CardTitle>
          <CardDescription>
            Bank transfer details for settling open invoices.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Account name</p>
            <p className="font-medium">{BANK_DETAILS.accountName}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Bank</p>
            <p className="font-medium">{BANK_DETAILS.bankName}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs text-muted-foreground">IBAN</p>
            <p className="font-mono font-medium">{BANK_DETAILS.iban}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-sm text-muted-foreground">
              {BANK_DETAILS.currencyNote}
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate, formatNumber, formatUsdCents } from "@/lib/format";
import { subscriptionAmountCents } from "@/lib/invoicing";
import { isInvoiceOverdue, type InvoiceRow } from "@/lib/invoices";
import { StartSubscriptionButton } from "./start-subscription-button";

type Status = "not_subscribed" | "active" | "overdue";

const STATUS_UI: Record<
  Status,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  not_subscribed: { label: "Not subscribed", variant: "secondary" },
  active: { label: "Active", variant: "default" },
  overdue: { label: "Overdue", variant: "destructive" },
};

export function SubscriptionCard(props: {
  tenantId: string;
  subscriptionStartedAt: Date | null;
  subscriptionRenewsAt: Date | null;
  pricePerDeviceCents: number;
  paidDeviceCount: number;
  invoices: InvoiceRow[];
  disabled?: boolean;
}) {
  const now = new Date();
  // "Overdue" is derived, never stored — the rule lives in lib/invoices.ts.
  const hasOverdueInvoice = props.invoices.some((inv) => isInvoiceOverdue(inv, now));
  const hasOpenSubscriptionInvoice = props.invoices.some(
    (inv) => inv.kind === "subscription" && inv.status === "open",
  );
  const status: Status =
    props.subscriptionStartedAt === null
      ? "not_subscribed"
      : hasOverdueInvoice
        ? "overdue"
        : "active";
  const ui = STATUS_UI[status];
  const annualAmountCents = subscriptionAmountCents(
    props.paidDeviceCount,
    props.pricePerDeviceCents,
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle>Subscription</CardTitle>
          <CardDescription>Annual, billed by bank transfer.</CardDescription>
        </div>
        <Badge variant={ui.variant}>{ui.label}</Badge>
      </CardHeader>
      <CardContent>
        {status === "not_subscribed" ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {hasOpenSubscriptionInvoice
                ? "A subscription invoice has been issued and is waiting for payment. Mark it paid below to activate the subscription, or void it to start over."
                : `No subscription yet. Starting one issues an invoice for every claimed device at ${formatUsdCents(props.pricePerDeviceCents)}/device/month, billed annually.`}
            </p>
            {/* The Start button stays visible for the whole window between
                issuing and payment (subscriptionStartedAt is only written on
                payment), so it is hidden explicitly once an invoice is open —
                a second click would issue a second full year. The server
                action rejects it too; this just avoids the dead end. */}
            {!props.disabled && !hasOpenSubscriptionInvoice && (
              <StartSubscriptionButton tenantId={props.tenantId} />
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Started</p>
              <p className="font-medium">
                {formatDate(props.subscriptionStartedAt as Date)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Renews</p>
              <p className="font-medium">
                {props.subscriptionRenewsAt
                  ? formatDate(props.subscriptionRenewsAt)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Paid devices</p>
              <p className="font-medium tabular-nums">
                {formatNumber(props.paidDeviceCount)}
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
  );
}

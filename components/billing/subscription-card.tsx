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
import type { InvoiceRow } from "@/lib/invoices";
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
  // "Overdue" is derived, never stored — an open invoice past its due date.
  const hasOverdueInvoice = props.invoices.some(
    (inv) => inv.status === "open" && inv.dueAt < now,
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
              No subscription yet. Starting one issues an invoice for every
              claimed device at {formatUsdCents(props.pricePerDeviceCents)}
              /device/month, billed annually.
            </p>
            {!props.disabled && (
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

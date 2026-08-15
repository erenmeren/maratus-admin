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
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDate, formatTryKurus, formatUsdCents } from "@/lib/format";
import {
  canVoidInvoice,
  isInvoiceOverdue,
  voidConsequence,
  type InvoiceRow,
} from "@/lib/invoices";
import { MarkPaidDialog } from "./mark-paid-dialog";
import { VoidInvoiceDialog } from "./void-invoice-dialog";

const KIND_LABELS: Record<InvoiceRow["kind"], string> = {
  subscription: "Subscription",
  proration: "Proration",
  overage: "Overage",
};

type DisplayStatus = "open" | "paid" | "void" | "overdue";

const STATUS_UI: Record<
  DisplayStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  open: { label: "Open", variant: "secondary" },
  paid: { label: "Paid", variant: "default" },
  void: { label: "Void", variant: "outline" },
  overdue: { label: "Overdue", variant: "destructive" },
};

/** "Overdue" is derived, never stored — the rule lives in lib/invoices.ts. */
function displayStatus(inv: InvoiceRow, now: Date): DisplayStatus {
  return isInvoiceOverdue(inv, now) ? "overdue" : inv.status;
}

/**
 * `isSubscribed` is what decides whether a `subscription` invoice is a
 * re-issuable first invoice or an unrecoverable cron renewal — see
 * canVoidInvoice. It is required rather than optional so a new call site
 * cannot silently default into offering an unsafe Void.
 */
export function InvoiceTable({
  invoices,
  isSubscribed,
  disabled,
}: {
  invoices: InvoiceRow[];
  isSubscribed: boolean;
  disabled?: boolean;
}) {
  const now = new Date();

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
        <CardDescription>
          Subscription, proration and overage invoices, settled by bank
          transfer.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {invoices.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">
            No invoices yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Kind</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="w-28 pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => {
                const status = displayStatus(inv, now);
                const ui = STATUS_UI[status];
                // A void row keeps its (org, kind, periodStart) slot forever,
                // so Void is only offered where a re-issue is actually
                // possible. Where it is not, the button stays visible but
                // disabled with the reason — an absent affordance would leave
                // the operator hunting for a control that was deliberately
                // withheld.
                const voidable = canVoidInvoice({
                  kind: inv.kind,
                  isSubscribed,
                });
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="pl-6">
                      {KIND_LABELS[inv.kind]}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatUsdCents(inv.amountUsdCents)}
                      {inv.status === "paid" && inv.tryAmountKurus != null && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          ({formatTryKurus(inv.tryAmountKurus)})
                        </span>
                      )}
                      {/* Carried-over prepaid credits are burned at issuance;
                          when they absorb the whole overage the invoice is
                          $0 and born paid, so say why. */}
                      {(inv.creditsConsumed ?? 0) > 0 && (
                        <span className="ml-1.5 block text-xs text-muted-foreground">
                          {inv.creditsConsumed} credit
                          {inv.creditsConsumed === 1 ? "" : "s"} applied
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ui.variant}>{ui.label}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(inv.dueAt)}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      {inv.status === "open" && !disabled && (
                        <div className="flex items-center justify-end gap-1">
                          <MarkPaidDialog
                            invoiceId={inv.id}
                            amountUsdCents={inv.amountUsdCents}
                          />
                          {voidable.ok ? (
                            <VoidInvoiceDialog
                              invoiceId={inv.id}
                              amountUsdCents={inv.amountUsdCents}
                              consequence={voidConsequence(inv.kind)}
                            />
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                {/* A disabled button fires no pointer events,
                                    so the trigger has to wrap it. */}
                                <span tabIndex={0}>
                                  <Button size="sm" variant="ghost" disabled>
                                    Void
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                {voidable.reason}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

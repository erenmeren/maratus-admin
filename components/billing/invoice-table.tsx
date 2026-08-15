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
import { formatDate, formatTryKurus, formatUsdCents } from "@/lib/format";
import type { InvoiceRow } from "@/lib/invoices";
import { MarkPaidDialog } from "./mark-paid-dialog";

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

/** "Overdue" is derived, never stored: an open invoice past its due date. */
function displayStatus(inv: InvoiceRow, now: Date): DisplayStatus {
  if (inv.status === "open" && inv.dueAt < now) return "overdue";
  return inv.status;
}

export function InvoiceTable({
  tenantId,
  invoices,
  disabled,
}: {
  tenantId: string;
  invoices: InvoiceRow[];
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
                    </TableCell>
                    <TableCell>
                      <Badge variant={ui.variant}>{ui.label}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(inv.dueAt)}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      {inv.status === "open" && !disabled && (
                        <MarkPaidDialog
                          tenantId={tenantId}
                          invoiceId={inv.id}
                          amountUsdCents={inv.amountUsdCents}
                        />
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

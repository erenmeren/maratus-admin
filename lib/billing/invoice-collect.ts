// lib/billing/invoice-collect.ts
// Pure, IO-free builder that maps a local invoice row onto the params for a
// Stripe one-off invoice (Phase 1A). No DB/env/Stripe imports — unit-tested in
// isolation; the IO that uses this lives in stripe-billing.ts (sendInvoiceToStripe).

export interface StripeInvoiceParams {
  collectionMethod: "charge_automatically" | "send_invoice";
  // null for charge_automatically; the Net-N day count for send_invoice.
  daysUntilDue: number | null;
  item: { amountCents: number; currency: "usd"; description: string };
}

const SEND_INVOICE_NET_DAYS = 14;

/** Format an invoice period as e.g. "Jun 2026" (UTC, so it matches periodStart). */
export function invoicePeriodLabel(periodStart: Date): string {
  return periodStart.toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function stripeInvoiceParamsFor(
  invoice: {
    amountDueCents: number;
    documentCount: number;
    unitPriceCents: number;
    periodStart: Date;
  },
  opts: { hasCard: boolean },
): StripeInvoiceParams {
  const collectionMethod = opts.hasCard ? "charge_automatically" : "send_invoice";
  const unitPrice = (invoice.unitPriceCents / 100).toFixed(2);
  const description = `Documents — ${invoicePeriodLabel(invoice.periodStart)}: ${invoice.documentCount.toLocaleString("en-US")} × $${unitPrice}`;
  return {
    collectionMethod,
    daysUntilDue: opts.hasCard ? null : SEND_INVOICE_NET_DAYS,
    item: { amountCents: invoice.amountDueCents, currency: "usd", description },
  };
}

// lib/billing/billing-status.ts
// Pure, IO-free Stripe billing mappers. No DB/env/Stripe-client imports here so
// these can be unit-tested in isolation (the IO functions live in
// stripe-billing.ts and invoice-sync.ts).

import type Stripe from "stripe";
import { id } from "@/lib/ids";

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "void";

/** Map a Stripe invoice status onto our enum. */
export function statusForStripeInvoice(stripeStatus: string): InvoiceStatus {
  switch (stripeStatus) {
    case "draft":
      return "draft";
    case "paid":
      return "paid";
    case "void":
      return "void";
    case "uncollectible":
      return "overdue";
    default:
      // open / unknown → unpaid-but-issued
      return "sent";
  }
}

/** Shape a Billing Meter event reporting one document for a customer. */
export function meterEventPayload(stripeCustomerId: string, eventName: string) {
  return {
    event_name: eventName,
    payload: { stripe_customer_id: stripeCustomerId, value: "1" },
  };
}

const SUSPENDED_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

/** True when a subscription is terminally unpaid (org should be suspended). */
export function isSuspended(subscriptionStatus: string | null): boolean {
  return subscriptionStatus != null && SUSPENDED_STATUSES.has(subscriptionStatus);
}

/** Pure: shape an `invoice` insert row from a Stripe invoice. */
export function invoiceRowFromStripe(si: Stripe.Invoice, organizationId: string) {
  const documentCount = si.lines?.data?.reduce((n, l) => n + (l.quantity ?? 0), 0) ?? 0;
  return {
    id: id("inv"),
    organizationId,
    periodStart: new Date((si.period_start ?? 0) * 1000),
    periodEnd: new Date((si.period_end ?? 0) * 1000),
    documentCount,
    amountDueCents: si.amount_due ?? 0,
    status: statusForStripeInvoice(si.status ?? "open"),
    stripeInvoiceId: si.id,
    hostedInvoiceUrl: si.hosted_invoice_url ?? null,
  };
}

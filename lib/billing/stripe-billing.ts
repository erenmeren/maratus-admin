// lib/billing/stripe-billing.ts
// Stripe billing: pure mappers (this section) + IO functions (added in Task 5).

type InvoiceStatus = "draft" | "sent" | "paid";

/** Map a Stripe invoice status onto our 3-state enum. */
export function statusForStripeInvoice(stripeStatus: string): InvoiceStatus {
  switch (stripeStatus) {
    case "draft":
      return "draft";
    case "paid":
      return "paid";
    default:
      // open / uncollectible / void → treated as unpaid-but-issued for the MVP.
      return "sent";
  }
}

/** Shape a Billing Meter event reporting one receipt for a customer. */
export function meterEventPayload(stripeCustomerId: string, eventName: string) {
  return {
    event_name: eventName,
    payload: { stripe_customer_id: stripeCustomerId, value: "1" },
  };
}

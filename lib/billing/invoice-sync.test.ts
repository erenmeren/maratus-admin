import { describe, it, expect } from "vitest";
import { invoiceRowFromStripe } from "./billing-status";

const fakeInvoice = {
  id: "in_123",
  status: "open",
  hosted_invoice_url: "https://pay.stripe.test/in_123",
  amount_due: 1234,
  period_start: 1700000000,
  period_end: 1702592000,
  lines: { data: [{ quantity: 42 }] },
};

describe("invoiceRowFromStripe", () => {
  it("maps a Stripe invoice onto our invoice row shape", () => {
    const row = invoiceRowFromStripe(fakeInvoice as never, "org_1");
    expect(row).toMatchObject({
      organizationId: "org_1",
      stripeInvoiceId: "in_123",
      hostedInvoiceUrl: "https://pay.stripe.test/in_123",
      amountDueCents: 1234,
      status: "sent", // open → sent
      documentCount: 42,
    });
    expect(row.periodStart).toBeInstanceOf(Date);
    expect(row.periodEnd).toBeInstanceOf(Date);
  });
});

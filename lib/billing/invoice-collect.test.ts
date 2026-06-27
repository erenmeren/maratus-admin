import { describe, it, expect } from "vitest";
import { stripeInvoiceParamsFor, invoicePeriodLabel } from "./invoice-collect";

const base = {
  amountDueCents: 4960,
  documentCount: 1240,
  unitPriceCents: 4,
  periodStart: new Date("2026-06-01T00:00:00.000Z"),
};

describe("invoicePeriodLabel", () => {
  it("formats the period as 'Mon YYYY' in UTC", () => {
    expect(invoicePeriodLabel(new Date("2026-06-01T00:00:00.000Z"))).toBe("Jun 2026");
    expect(invoicePeriodLabel(new Date("2026-12-31T23:59:59.999Z"))).toBe("Dec 2026");
  });
});

describe("stripeInvoiceParamsFor", () => {
  it("uses charge_automatically with no due date when a card is on file", () => {
    const p = stripeInvoiceParamsFor(base, { hasCard: true });
    expect(p.collectionMethod).toBe("charge_automatically");
    expect(p.daysUntilDue).toBeNull();
  });

  it("uses send_invoice with Net 14 when there is no card", () => {
    const p = stripeInvoiceParamsFor(base, { hasCard: false });
    expect(p.collectionMethod).toBe("send_invoice");
    expect(p.daysUntilDue).toBe(14);
  });

  it("passes the amount through and builds a usd line item", () => {
    const p = stripeInvoiceParamsFor(base, { hasCard: false });
    expect(p.item.amountCents).toBe(4960);
    expect(p.item.currency).toBe("usd");
  });

  it("describes the line with period, count (thousands-separated) and unit price", () => {
    const p = stripeInvoiceParamsFor(base, { hasCard: false });
    expect(p.item.description).toBe("Documents — Jun 2026: 1,240 × $0.04");
  });
});

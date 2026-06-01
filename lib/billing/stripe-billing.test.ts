import { describe, it, expect } from "vitest";
import { statusForStripeInvoice, meterEventPayload } from "./billing-status";

describe("statusForStripeInvoice", () => {
  it("maps draft → draft", () => expect(statusForStripeInvoice("draft")).toBe("draft"));
  it("maps open → sent", () => expect(statusForStripeInvoice("open")).toBe("sent"));
  it("maps paid → paid", () => expect(statusForStripeInvoice("paid")).toBe("paid"));
  it("maps uncollectible → sent", () => expect(statusForStripeInvoice("uncollectible")).toBe("sent"));
  it("maps void → sent", () => expect(statusForStripeInvoice("void")).toBe("sent"));
  it("falls back unknown → sent", () => expect(statusForStripeInvoice("weird")).toBe("sent"));
});

describe("meterEventPayload", () => {
  it("builds a single-unit receipt event", () => {
    expect(meterEventPayload("cus_123", "receipts")).toEqual({
      event_name: "receipts",
      payload: { stripe_customer_id: "cus_123", value: "1" },
    });
  });
});

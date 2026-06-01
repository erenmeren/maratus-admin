import { describe, it, expect } from "vitest";
import { statusForStripeInvoice, meterEventPayload, isSuspended } from "./billing-status";

describe("statusForStripeInvoice", () => {
  it("maps draft → draft", () => expect(statusForStripeInvoice("draft")).toBe("draft"));
  it("maps open → sent", () => expect(statusForStripeInvoice("open")).toBe("sent"));
  it("maps paid → paid", () => expect(statusForStripeInvoice("paid")).toBe("paid"));
  it("maps uncollectible → overdue", () => expect(statusForStripeInvoice("uncollectible")).toBe("overdue"));
  it("maps void → void", () => expect(statusForStripeInvoice("void")).toBe("void"));

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

describe("isSuspended", () => {
  it("suspends on canceled/unpaid/incomplete_expired", () => {
    expect(isSuspended("canceled")).toBe(true);
    expect(isSuspended("unpaid")).toBe(true);
    expect(isSuspended("incomplete_expired")).toBe(true);
  });
  it("allows null/active/past_due/trialing", () => {
    expect(isSuspended(null)).toBe(false);
    expect(isSuspended("active")).toBe(false);
    expect(isSuspended("past_due")).toBe(false);
    expect(isSuspended("trialing")).toBe(false);
  });
});

describe("statusForStripeInvoice extended", () => {
  it("maps void → void and uncollectible → overdue", () => {
    expect(statusForStripeInvoice("void")).toBe("void");
    expect(statusForStripeInvoice("uncollectible")).toBe("overdue");
  });
});

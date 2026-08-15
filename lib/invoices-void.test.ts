import { describe, expect, it } from "vitest";
import { canVoidInvoice, voidConsequence } from "./invoices";

// Voiding does not free the (organizationId, kind, periodStart) slot — the
// unique index has no status predicate — so "is this voidable?" is really
// "can anything ever issue this slot again?".
describe("canVoidInvoice", () => {
  it("allows voiding a first subscription invoice (start subscription can re-issue)", () => {
    expect(canVoidInvoice({ kind: "subscription", isSubscribed: false })).toEqual({
      ok: true,
    });
  });

  it("refuses a renewal invoice: renewsAt only advances on payment, so the cron can never re-issue it", () => {
    const res = canVoidInvoice({ kind: "subscription", isSubscribed: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/renewal invoice can't be voided/i);
  });

  it("allows voiding a proration on either side of the subscription flag", () => {
    expect(canVoidInvoice({ kind: "proration", isSubscribed: true })).toEqual({
      ok: true,
    });
    expect(canVoidInvoice({ kind: "proration", isSubscribed: false })).toEqual({
      ok: true,
    });
  });

  it("refuses an overage invoice: its period is closed and its credits are already burned", () => {
    const res = canVoidInvoice({ kind: "overage", isSubscribed: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/overage invoice can't be voided/i);
  });

  it("refuses an overage invoice even before the org is subscribed", () => {
    expect(canVoidInvoice({ kind: "overage", isSubscribed: false }).ok).toBe(false);
  });
});

describe("voidConsequence", () => {
  it("tells a proration void that the device stays unpaid and is re-prorated", () => {
    expect(voidConsequence("proration")).toMatch(/stays unpaid/i);
    expect(voidConsequence("proration")).toMatch(/pro-rated again/i);
  });

  it("tells a subscription void that the customer stays unsubscribed and re-issue waits a day", () => {
    expect(voidConsequence("subscription")).toMatch(/stays unsubscribed/i);
    expect(voidConsequence("subscription")).toMatch(/tomorrow/i);
  });

  it("never promises the invoice comes back on its own", () => {
    for (const kind of ["subscription", "proration", "overage"] as const) {
      expect(voidConsequence(kind)).not.toMatch(/automatically re-?issued/i);
    }
  });
});

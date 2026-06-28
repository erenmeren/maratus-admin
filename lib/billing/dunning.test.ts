import { describe, it, expect } from "vitest";
import {
  GRACE_DAYS,
  previousMonthMarker,
  isOverdue,
  isPastGrace,
  paymentBlockVerdict,
} from "./dunning";

describe("previousMonthMarker", () => {
  it("returns a date inside the previous calendar month", () => {
    const m = previousMonthMarker(new Date(2026, 6, 3)); // Jul 3 2026
    expect(m.getFullYear()).toBe(2026);
    expect(m.getMonth()).toBe(5); // June
  });
  it("rolls over the year for January", () => {
    const m = previousMonthMarker(new Date(2026, 0, 10)); // Jan 10 2026
    expect(m.getFullYear()).toBe(2025);
    expect(m.getMonth()).toBe(11); // December
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-07-01T00:00:00Z");
  it("is true for a sent invoice whose dueDate has passed", () => {
    expect(isOverdue({ status: "sent", dueDate: new Date("2026-06-30T00:00:00Z") }, now)).toBe(true);
  });
  it("is false when not yet due", () => {
    expect(isOverdue({ status: "sent", dueDate: new Date("2026-07-05T00:00:00Z") }, now)).toBe(false);
  });
  it("is false for non-sent or null-dueDate invoices", () => {
    expect(isOverdue({ status: "draft", dueDate: new Date("2026-06-01T00:00:00Z") }, now)).toBe(false);
    expect(isOverdue({ status: "paid", dueDate: new Date("2026-06-01T00:00:00Z") }, now)).toBe(false);
    expect(isOverdue({ status: "sent", dueDate: null }, now)).toBe(false);
  });
});

describe("isPastGrace", () => {
  const now = new Date("2026-07-20T00:00:00Z");
  it("is true when an overdue invoice is past dueDate + GRACE_DAYS", () => {
    // dueDate Jul 1 + 7d = Jul 8 < Jul 20
    expect(isPastGrace({ status: "overdue", dueDate: new Date("2026-07-01T00:00:00Z") }, now)).toBe(true);
  });
  it("is false while still within grace", () => {
    // dueDate Jul 15 + 7d = Jul 22 > Jul 20
    expect(isPastGrace({ status: "overdue", dueDate: new Date("2026-07-15T00:00:00Z") }, now)).toBe(false);
  });
  it("is false for a null dueDate (charge_automatically) or non-overdue", () => {
    expect(isPastGrace({ status: "overdue", dueDate: null }, now)).toBe(false);
    expect(isPastGrace({ status: "sent", dueDate: new Date("2026-07-01T00:00:00Z") }, now)).toBe(false);
  });
});

describe("paymentBlockVerdict", () => {
  it("blocks suspended subscriptions (takes precedence)", () => {
    expect(paymentBlockVerdict({ subscriptionStatus: "canceled", hasPastGraceOverdue: true }))
      .toEqual({ blocked: true, reason: "suspended" });
  });
  it("blocks past-grace overdue when not suspended", () => {
    expect(paymentBlockVerdict({ subscriptionStatus: "active", hasPastGraceOverdue: true }))
      .toEqual({ blocked: true, reason: "past_due" });
  });
  it("allows a clean org", () => {
    expect(paymentBlockVerdict({ subscriptionStatus: "active", hasPastGraceOverdue: false }))
      .toEqual({ blocked: false, reason: null });
    expect(paymentBlockVerdict({ subscriptionStatus: null, hasPastGraceOverdue: false }))
      .toEqual({ blocked: false, reason: null });
  });
});

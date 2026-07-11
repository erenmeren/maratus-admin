import { describe, expect, it } from "vitest";
import {
  DEFAULT_INCLUDED_TRIGGERS,
  FAIR_USE_TRIGGERS_PER_DEVICE_MONTH,
  monthKey,
  triggerBillingDecision,
} from "./billing-plan";

describe("monthKey", () => {
  it("formats a UTC calendar month", () => {
    expect(monthKey(new Date("2026-07-11T21:00:00Z"))).toBe("2026-07");
  });
  it("uses UTC at year boundaries", () => {
    expect(monthKey(new Date("2025-12-31T23:59:59Z"))).toBe("2025-12");
    expect(monthKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });
  it("zero-pads single-digit months", () => {
    expect(monthKey(new Date("2026-03-05T12:00:00Z"))).toBe("2026-03");
  });
});

describe("triggerBillingDecision", () => {
  it("credits plan always pays with credits", () => {
    expect(
      triggerBillingDecision({ plan: "credits", includedTriggersPerDevice: 2000, usedThisMonth: 1 }),
    ).toEqual({ mode: "credits" });
  });

  it("flat plan is included up to and including the fair-use ceiling", () => {
    expect(
      triggerBillingDecision({
        plan: "flat", includedTriggersPerDevice: 2000,
        usedThisMonth: FAIR_USE_TRIGGERS_PER_DEVICE_MONTH,
      }),
    ).toEqual({ mode: "included" });
  });

  it("flat plan rejects past the fair-use ceiling", () => {
    expect(
      triggerBillingDecision({
        plan: "flat", includedTriggersPerDevice: 2000,
        usedThisMonth: FAIR_USE_TRIGGERS_PER_DEVICE_MONTH + 1,
      }),
    ).toEqual({ mode: "fair_use_exceeded" });
  });

  it("base_usage is included up to and including the quota", () => {
    expect(
      triggerBillingDecision({ plan: "base_usage", includedTriggersPerDevice: 2000, usedThisMonth: 2000 }),
    ).toEqual({ mode: "included" });
  });

  it("base_usage falls through to credits past the quota", () => {
    expect(
      triggerBillingDecision({ plan: "base_usage", includedTriggersPerDevice: 2000, usedThisMonth: 2001 }),
    ).toEqual({ mode: "credits" });
  });

  it("exports the spec default quota", () => {
    expect(DEFAULT_INCLUDED_TRIGGERS).toBe(2000);
  });
});

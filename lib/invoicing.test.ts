import { describe, expect, it } from "vitest";
import {
  DEFAULT_INCLUDED_TRIGGERS_PER_DEVICE,
  DEFAULT_OVERAGE_PRICE_CENTS,
  DEFAULT_PRICE_PER_DEVICE_CENTS,
  DUE_DAYS,
  dueAtFrom,
  monthsRemainingUntil,
  overageFor,
  prorationAmountCents,
  subscriptionAmountCents,
} from "./invoicing";

describe("defaults", () => {
  it("prices a device at $15/month and overage at 2 cents", () => {
    expect(DEFAULT_PRICE_PER_DEVICE_CENTS).toBe(1500);
    expect(DEFAULT_OVERAGE_PRICE_CENTS).toBe(2);
    expect(DEFAULT_INCLUDED_TRIGGERS_PER_DEVICE).toBe(1000);
    expect(DUE_DAYS).toBe(14);
  });
});

describe("subscriptionAmountCents", () => {
  it("charges twelve months per device", () => {
    expect(subscriptionAmountCents(2, 1500)).toBe(36_000); // $360
  });

  it("is zero with no devices", () => {
    expect(subscriptionAmountCents(0, 1500)).toBe(0);
  });

  it("honours a negotiated price", () => {
    expect(subscriptionAmountCents(1, 1200)).toBe(14_400);
  });
});

describe("monthsRemainingUntil", () => {
  const renewsAt = new Date("2027-03-12T09:00:00Z");

  it("counts whole months left, rounding up a partial month", () => {
    // Device added in month 5 of 12 → 7 months remain.
    expect(monthsRemainingUntil(renewsAt, new Date("2026-08-12T09:00:00Z"))).toBe(7);
  });

  it("rounds a partial month up so the customer is never billed zero", () => {
    expect(monthsRemainingUntil(renewsAt, new Date("2027-02-20T00:00:00Z"))).toBe(1);
  });

  it("is 0 at or past the renewal instant", () => {
    expect(monthsRemainingUntil(renewsAt, new Date("2027-03-12T09:00:00Z"))).toBe(0);
    expect(monthsRemainingUntil(renewsAt, new Date("2027-04-01T00:00:00Z"))).toBe(0);
  });

  it("never exceeds a full year", () => {
    expect(monthsRemainingUntil(renewsAt, new Date("2026-03-12T09:00:00Z"))).toBe(12);
  });
});

describe("prorationAmountCents", () => {
  it("bills the remaining months at the device price", () => {
    expect(prorationAmountCents(1500, 7)).toBe(10_500); // $105
  });

  it("is zero when nothing remains", () => {
    expect(prorationAmountCents(1500, 0)).toBe(0);
  });
});

describe("overageFor", () => {
  const base = {
    includedPerDevice: 1000,
    paidDeviceCount: 2,
    overagePriceCents: 2,
    legacyCredits: 0,
  };

  it("pools quota across paid devices", () => {
    const r = overageFor({ ...base, used: 2000 });
    expect(r.includedTotal).toBe(2000);
    expect(r.overageTriggers).toBe(0);
    expect(r.amountUsdCents).toBe(0);
  });

  it("charges only what exceeds the pool", () => {
    const r = overageFor({ ...base, used: 2240 });
    expect(r.overageTriggers).toBe(240);
    expect(r.billableTriggers).toBe(240);
    expect(r.amountUsdCents).toBe(480); // $4.80
  });

  it("ignores which device burned the quota", () => {
    // One device consuming the whole pool is explicitly allowed.
    expect(overageFor({ ...base, used: 1999 }).amountUsdCents).toBe(0);
  });

  it("gives an unpaid fleet no quota at all", () => {
    const r = overageFor({ ...base, paidDeviceCount: 0, used: 10 });
    expect(r.includedTotal).toBe(0);
    expect(r.overageTriggers).toBe(10);
  });

  it("offsets legacy credits before billing", () => {
    const r = overageFor({ ...base, used: 2500, legacyCredits: 300 });
    expect(r.overageTriggers).toBe(500);
    expect(r.creditsConsumed).toBe(300);
    expect(r.billableTriggers).toBe(200);
    expect(r.amountUsdCents).toBe(400);
  });

  it("consumes no more credits than the overage", () => {
    const r = overageFor({ ...base, used: 2050, legacyCredits: 500 });
    expect(r.creditsConsumed).toBe(50);
    expect(r.billableTriggers).toBe(0);
    expect(r.amountUsdCents).toBe(0);
  });
});

describe("dueAtFrom", () => {
  it("is net 14 from issue", () => {
    expect(dueAtFrom(new Date("2026-04-12T09:00:00Z")).toISOString()).toBe(
      "2026-04-26T09:00:00.000Z",
    );
  });
});

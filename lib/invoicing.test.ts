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
  prorationMonths,
  prorationMonthsThrough,
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
    slotCount: 2,
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
    const r = overageFor({ ...base, slotCount: 0, used: 10 });
    expect(r.includedTotal).toBe(0);
    expect(r.overageTriggers).toBe(10);
  });

  it("pools quota from paid SLOTS, not from live devices", () => {
    // Two slots paid for, one device currently occupying them (the other is at
    // RMA). The pool must stay at 2000 — this is the whole point of slots.
    const r = overageFor({
      used: 2500,
      includedPerDevice: 1000,
      slotCount: 2,
      overagePriceCents: 2,
      legacyCredits: 0,
    });
    expect(r.includedTotal).toBe(2000);
    expect(r.overageTriggers).toBe(500);
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

describe("prorationMonths", () => {
  it("passes an ordinary mid-year claim through untouched", () => {
    expect(prorationMonths(7)).toBe(7);
  });

  it("bills a full month for a device claimed at or after renewal", () => {
    // monthsRemainingUntil returns 0 once now >= renewsAt — routine while a
    // renewal sits unpaid. Zero months means no invoice at all, so the device
    // would be claimed, unpaid and invisible.
    expect(prorationMonths(0)).toBe(1);
  });

  it("never returns a negative or zero month count", () => {
    expect(prorationMonths(-3)).toBe(1);
  });

  it("never exceeds a full year", () => {
    expect(prorationMonths(99)).toBe(12);
  });

  it("always prices to something billable", () => {
    for (const m of [-1, 0, 1, 12, 13]) {
      expect(prorationAmountCents(1500, prorationMonths(m))).toBeGreaterThan(0);
    }
  });
});

describe("prorationMonthsThrough", () => {
  const renewsAt = new Date("2026-10-01T00:00:00Z");
  it("with no open renewal, bills the months left until renewsAt (min 1)", () => {
    expect(prorationMonthsThrough({ renewsAt, now: new Date("2026-09-11T00:00:00Z"), openRenewalPeriodEnd: null })).toBe(1);
    expect(prorationMonthsThrough({ renewsAt, now: new Date("2026-10-05T00:00:00Z"), openRenewalPeriodEnd: null })).toBe(1);
    expect(prorationMonthsThrough({ renewsAt, now: new Date("2026-04-01T00:00:00Z"), openRenewalPeriodEnd: null })).toBe(6);
  });
  it("with an open renewal already issued, covers the next year too", () => {
    const nextEnd = new Date("2027-10-01T00:00:00Z");
    // 20 days before the anniversary: 1 (remainder) + 12 (the issued year).
    expect(prorationMonthsThrough({ renewsAt, now: new Date("2026-09-11T00:00:00Z"), openRenewalPeriodEnd: nextEnd })).toBe(13);
    // After the anniversary with the renewal still unpaid: what is left of the issued year.
    expect(prorationMonthsThrough({ renewsAt, now: new Date("2026-11-15T00:00:00Z"), openRenewalPeriodEnd: nextEnd })).toBe(11);
  });
  it("prices a 13-month proration without clamping to a year", () => {
    expect(prorationAmountCents(1500, 13)).toBe(19_500);
  });
});

import { describe, it, expect } from "vitest";
import {
  isValidWindowDays,
  isValidWarrantyMonths,
  addCalendarMonths,
  coverageStatus,
} from "./coverage";

describe("isValidWindowDays", () => {
  it("accepts integers in 1..3650", () => {
    expect(isValidWindowDays(1)).toBe(true);
    expect(isValidWindowDays(30)).toBe(true);
    expect(isValidWindowDays(3650)).toBe(true);
  });
  it("rejects zero, negatives, non-integers, and over-max", () => {
    expect(isValidWindowDays(0)).toBe(false);
    expect(isValidWindowDays(-5)).toBe(false);
    expect(isValidWindowDays(1.5)).toBe(false);
    expect(isValidWindowDays(3651)).toBe(false);
    expect(isValidWindowDays(Number.NaN)).toBe(false);
  });
});

describe("isValidWarrantyMonths", () => {
  it("accepts integers in 1..120", () => {
    expect(isValidWarrantyMonths(1)).toBe(true);
    expect(isValidWarrantyMonths(12)).toBe(true);
    expect(isValidWarrantyMonths(120)).toBe(true);
  });
  it("rejects zero, negatives, non-integers, and over-max", () => {
    expect(isValidWarrantyMonths(0)).toBe(false);
    expect(isValidWarrantyMonths(-1)).toBe(false);
    expect(isValidWarrantyMonths(2.2)).toBe(false);
    expect(isValidWarrantyMonths(121)).toBe(false);
  });
});

describe("addCalendarMonths", () => {
  it("adds whole months", () => {
    expect(addCalendarMonths(new Date("2026-06-15T00:00:00Z"), 12).toISOString())
      .toBe("2027-06-15T00:00:00.000Z");
  });
  it("clamps month-overflow to the last day of the target month", () => {
    // Jan 31 + 1 month → Feb 28 (2026 is not a leap year), not Mar 3.
    expect(addCalendarMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString())
      .toBe("2026-02-28T00:00:00.000Z");
    // Leap year: Jan 31 + 1 month → Feb 29.
    expect(addCalendarMonths(new Date("2028-01-31T00:00:00Z"), 1).toISOString())
      .toBe("2028-02-29T00:00:00.000Z");
  });
});

describe("coverageStatus", () => {
  const createdAt = new Date("2026-06-01T00:00:00Z");

  it("returns show:false when both windows are off", () => {
    const c = coverageStatus(
      { createdAt, returnWindowDays: null, warrantyPeriodMonths: null },
      new Date("2026-06-10T00:00:00Z"),
    );
    expect(c.show).toBe(false);
    expect(c.return).toBeNull();
    expect(c.warranty).toBeNull();
  });

  it("treats invalid config as off", () => {
    const c = coverageStatus(
      { createdAt, returnWindowDays: 0, warrantyPeriodMonths: -3 },
      new Date("2026-06-10T00:00:00Z"),
    );
    expect(c.show).toBe(false);
  });

  it("computes an open return window", () => {
    const c = coverageStatus(
      { createdAt, returnWindowDays: 30, warrantyPeriodMonths: null },
      new Date("2026-06-10T00:00:00Z"), // before Jul 1
    );
    expect(c.show).toBe(true);
    expect(c.return).not.toBeNull();
    expect(c.return!.expired).toBe(false);
    expect(c.return!.untilDate.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("marks a passed return window expired", () => {
    const c = coverageStatus(
      { createdAt, returnWindowDays: 30, warrantyPeriodMonths: null },
      new Date("2026-08-01T00:00:00Z"), // after Jul 1
    );
    expect(c.return!.expired).toBe(true);
  });

  it("computes warranty expiry in calendar months", () => {
    const c = coverageStatus(
      { createdAt, returnWindowDays: null, warrantyPeriodMonths: 12 },
      new Date("2026-06-10T00:00:00Z"),
    );
    expect(c.warranty).not.toBeNull();
    expect(c.warranty!.expired).toBe(false);
    expect(c.warranty!.untilDate.toISOString()).toBe("2027-06-01T00:00:00.000Z");
  });
});

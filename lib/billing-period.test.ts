import { describe, expect, it } from "vitest";
import {
  addMonthsAnchored,
  periodEndFor,
  periodIndexFor,
  periodStartFor,
  renewalDueAt,
} from "./billing-period";

describe("addMonthsAnchored", () => {
  it("adds whole months keeping the day of month", () => {
    expect(addMonthsAnchored(new Date("2026-03-12T09:00:00Z"), 1).toISOString()).toBe(
      "2026-04-12T09:00:00.000Z",
    );
  });

  it("clamps to the last day of a shorter month", () => {
    expect(addMonthsAnchored(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("returns to the anchor day after a clamped month", () => {
    // The anchor is 31, not the clamped 28: two months out must be 31 March.
    expect(addMonthsAnchored(new Date("2026-01-31T00:00:00Z"), 2).toISOString()).toBe(
      "2026-03-31T00:00:00.000Z",
    );
  });

  it("handles leap years", () => {
    expect(addMonthsAnchored(new Date("2024-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2024-02-29T00:00:00.000Z",
    );
  });

  it("crosses year boundaries", () => {
    expect(addMonthsAnchored(new Date("2026-11-15T12:00:00Z"), 3).toISOString()).toBe(
      "2027-02-15T12:00:00.000Z",
    );
  });
});

describe("periodIndexFor", () => {
  const anchor = new Date("2026-03-12T09:00:00Z");

  it("is 0 on the start instant", () => {
    expect(periodIndexFor(anchor, new Date("2026-03-12T09:00:00Z"))).toBe(0);
  });

  it("is 0 one millisecond before the next period", () => {
    expect(periodIndexFor(anchor, new Date("2026-04-12T08:59:59.999Z"))).toBe(0);
  });

  it("is 1 on the next anniversary instant", () => {
    expect(periodIndexFor(anchor, new Date("2026-04-12T09:00:00Z"))).toBe(1);
  });

  it("counts whole months across a year", () => {
    expect(periodIndexFor(anchor, new Date("2027-03-12T09:00:00Z"))).toBe(12);
  });

  it("does not over-count when the month clamped", () => {
    // 31 Jan anchor: on 28 Feb we are still in period 0 until the clamped instant.
    const jan31 = new Date("2026-01-31T00:00:00Z");
    expect(periodIndexFor(jan31, new Date("2026-02-27T23:59:59Z"))).toBe(0);
    expect(periodIndexFor(jan31, new Date("2026-02-28T00:00:00Z"))).toBe(1);
  });
});

describe("periodStartFor / periodEndFor", () => {
  const anchor = new Date("2026-03-12T09:00:00Z");

  it("brackets the current period", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    expect(periodStartFor(anchor, now).toISOString()).toBe("2026-04-12T09:00:00.000Z");
    expect(periodEndFor(anchor, now).toISOString()).toBe("2026-05-12T09:00:00.000Z");
  });

  it("start is inclusive and end is exclusive", () => {
    const start = periodStartFor(anchor, new Date("2026-04-12T09:00:00Z"));
    expect(start.toISOString()).toBe("2026-04-12T09:00:00.000Z");
  });
});

describe("renewalDueAt", () => {
  it("is twelve months after the anchor", () => {
    expect(renewalDueAt(new Date("2026-03-12T09:00:00Z")).toISOString()).toBe(
      "2027-03-12T09:00:00.000Z",
    );
  });

  it("clamps a 29 February anchor", () => {
    expect(renewalDueAt(new Date("2024-02-29T00:00:00Z")).toISOString()).toBe(
      "2025-02-28T00:00:00.000Z",
    );
  });
});

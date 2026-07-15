import { describe, it, expect } from "vitest";
import { dayKeys, monthKeys, bucketsToSeries, countByDayKey, countByMonthKey } from "./analytics";
import { computeTrend } from "./analytics";

const NOW = new Date("2026-06-05T12:00:00Z");

describe("dayKeys", () => {
  it("returns n UTC day keys ending today, oldest first", () => {
    expect(dayKeys(NOW, 3)).toEqual([
      { key: "2026-06-03", label: "Jun 3" },
      { key: "2026-06-04", label: "Jun 4" },
      { key: "2026-06-05", label: "Jun 5" },
    ]);
  });
});

describe("monthKeys", () => {
  it("returns n UTC month keys ending this month, oldest first", () => {
    expect(monthKeys(NOW, 3)).toEqual([
      { key: "2026-04", label: "Apr" },
      { key: "2026-05", label: "May" },
      { key: "2026-06", label: "Jun" },
    ]);
  });
});

describe("bucketsToSeries", () => {
  it("zero-fills missing buckets", () => {
    const keys = dayKeys(NOW, 3);
    const series = bucketsToSeries([{ bucket: "2026-06-04", count: 5 }], keys);
    expect(series).toEqual([
      { label: "Jun 3", activations: 0 },
      { label: "Jun 4", activations: 5 },
      { label: "Jun 5", activations: 0 },
    ]);
  });
});

describe("computeTrend", () => {
  it("computes percent change", () => {
    expect(computeTrend(10, 5)).toEqual({ current: 10, previous: 5, pctChange: 100 });
    expect(computeTrend(5, 10)).toEqual({ current: 5, previous: 10, pctChange: -50 });
  });
  it("returns null pctChange when previous is 0", () => {
    expect(computeTrend(5, 0).pctChange).toBeNull();
    expect(computeTrend(0, 0).pctChange).toBeNull();
  });
});

describe("key boundary crossings", () => {
  it("dayKeys crosses a month boundary", () => {
    expect(dayKeys(new Date("2026-06-01T00:00:00Z"), 3)).toEqual([
      { key: "2026-05-30", label: "May 30" },
      { key: "2026-05-31", label: "May 31" },
      { key: "2026-06-01", label: "Jun 1" },
    ]);
  });
  it("monthKeys crosses a year boundary", () => {
    expect(monthKeys(new Date("2026-01-15T00:00:00Z"), 3)).toEqual([
      { key: "2025-11", label: "Nov" },
      { key: "2025-12", label: "Dec" },
      { key: "2026-01", label: "Jan" },
    ]);
  });
});

describe("countByDayKey / countByMonthKey", () => {
  it("groups dates by UTC day (not local)", () => {
    const dates = [
      new Date("2026-06-05T23:00:00Z"),
      new Date("2026-06-05T01:00:00Z"),
      new Date("2026-06-04T12:00:00Z"),
    ];
    expect(new Map(countByDayKey(dates).map((c) => [c.bucket, c.count]))).toEqual(
      new Map([["2026-06-05", 2], ["2026-06-04", 1]]),
    );
  });
  it("groups dates by UTC month across a month boundary", () => {
    const dates = [new Date("2026-06-30T23:00:00Z"), new Date("2026-07-01T00:00:00Z")];
    expect(new Map(countByMonthKey(dates).map((c) => [c.bucket, c.count]))).toEqual(
      new Map([["2026-06", 1], ["2026-07", 1]]),
    );
  });
  it("returns [] for empty input", () => {
    expect(countByDayKey([])).toEqual([]);
    expect(countByMonthKey([])).toEqual([]);
  });
});


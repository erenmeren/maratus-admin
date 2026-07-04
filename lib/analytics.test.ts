import { describe, it, expect } from "vitest";
import { dayKeys, monthKeys, bucketsToSeries, countByDayKey, countByMonthKey } from "./analytics";
import {
  computeTrend,
  dowLabel,
  hourLabel,
  pickPeakDow,
  pickPeakHour,
  buildPeak,
  buildHeatmap,
  toComparisonRows,
} from "./analytics";

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

describe("dowLabel / hourLabel", () => {
  it("labels days of week", () => {
    expect(dowLabel(0)).toBe("Sundays");
    expect(dowLabel(6)).toBe("Saturdays");
  });
  it("labels hour ranges across am/pm boundaries", () => {
    expect(hourLabel(0)).toBe("12–1am");
    expect(hourLabel(12)).toBe("12–1pm");
    expect(hourLabel(23)).toBe("11pm–12am");
  });
});

describe("pickPeakDow / pickPeakHour", () => {
  it("returns the argmax (first on ties)", () => {
    expect(pickPeakDow([{ dow: 1, count: 3 }, { dow: 6, count: 9 }])).toEqual({ dow: 6, count: 9, label: "Saturdays" });
    expect(pickPeakHour([{ hour: 9, count: 2 }, { hour: 12, count: 8 }])).toEqual({ hour: 12, count: 8, label: "12–1pm" });
  });
  it("returns nulls when empty or all-zero", () => {
    expect(pickPeakDow([])).toEqual({ dow: null, count: 0, label: null });
    expect(pickPeakHour([{ hour: 3, count: 0 }])).toEqual({ hour: null, count: 0, label: null });
  });
});

describe("buildPeak", () => {
  it("composes dow + hour peaks", () => {
    expect(buildPeak([{ dow: 6, count: 9 }], [{ hour: 12, count: 8 }])).toEqual({
      busiestDow: 6, busiestDowLabel: "Saturdays", busiestDowCount: 9,
      peakHour: 12, peakHourLabel: "12–1pm", peakHourCount: 8,
    });
  });
});

describe("toComparisonRows", () => {
  it("maps + sorts by activations desc", () => {
    const rows = toComparisonRows([
      { storeId: "a", storeName: "A", current: 3, previous: 2 },
      { storeId: "b", storeName: "B", current: 10, previous: 5 },
    ]);
    expect(rows.map((r) => r.storeId)).toEqual(["b", "a"]);
    expect(rows[0].trend.pctChange).toBe(100);
    expect(rows[0].eco.activations).toBe(10);
  });
  it("returns [] for empty input", () => {
    expect(toComparisonRows([])).toEqual([]);
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

describe("hourLabel mid-range + dow tie", () => {
  it("formats same-period hours", () => {
    expect(hourLabel(9)).toBe("9–10am");
    expect(hourLabel(14)).toBe("2–3pm");
  });
  it("pickPeakDow keeps the first element on a tie", () => {
    expect(pickPeakDow([{ dow: 2, count: 5 }, { dow: 5, count: 5 }])).toEqual({ dow: 2, count: 5, label: "Tuesdays" });
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

describe("buildHeatmap", () => {
  it("returns an all-zero 7x24 grid for empty input", () => {
    const h = buildHeatmap([]);
    expect(h.grid.length).toBe(7);
    expect(h.grid.every((row) => row.length === 24)).toBe(true);
    expect(h.grid.flat().every((c) => c === 0)).toBe(true);
    expect(h.max).toBe(0);
    expect(h.total).toBe(0);
    expect(h.peak.busiestDow).toBeNull();
    expect(h.peak.peakHour).toBeNull();
  });

  it("places a single cell and derives the peak", () => {
    const h = buildHeatmap([{ dow: 2, hour: 8, count: 5 }]);
    expect(h.grid[2][8]).toBe(5);
    expect(h.max).toBe(5);
    expect(h.total).toBe(5);
    expect(h.peak.busiestDow).toBe(2);
    expect(h.peak.busiestDowCount).toBe(5);
    expect(h.peak.peakHour).toBe(8);
    expect(h.peak.peakHourCount).toBe(5);
  });

  it("sums counts and tracks max/total across cells", () => {
    const h = buildHeatmap([
      { dow: 1, hour: 9, count: 3 },
      { dow: 1, hour: 9, count: 2 },
      { dow: 1, hour: 10, count: 4 },
      { dow: 3, hour: 9, count: 1 },
    ]);
    expect(h.grid[1][9]).toBe(5);
    expect(h.grid[1][10]).toBe(4);
    expect(h.grid[3][9]).toBe(1);
    expect(h.max).toBe(5);
    expect(h.total).toBe(10);
    expect(h.peak.busiestDow).toBe(1);
    expect(h.peak.peakHour).toBe(9);
  });

  it("ignores out-of-range dow/hour", () => {
    const h = buildHeatmap([
      { dow: 7, hour: 0, count: 9 },
      { dow: 0, hour: 24, count: 9 },
      { dow: -1, hour: 5, count: 9 },
      { dow: 0, hour: 0, count: 1 },
    ]);
    expect(h.total).toBe(1);
    expect(h.max).toBe(1);
    expect(h.grid[0][0]).toBe(1);
  });
});

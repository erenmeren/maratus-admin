import { describe, it, expect } from "vitest";
import { dayKeys, monthKeys, bucketsToSeries } from "./analytics";

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
  it("zero-fills missing buckets and computes revenue", () => {
    const keys = dayKeys(NOW, 3);
    const series = bucketsToSeries([{ bucket: "2026-06-04", count: 5 }], keys, 4);
    expect(series).toEqual([
      { label: "Jun 3", receipts: 0, revenue: 0 },
      { label: "Jun 4", receipts: 5, revenue: 20 },
      { label: "Jun 5", receipts: 0, revenue: 0 },
    ]);
  });
});

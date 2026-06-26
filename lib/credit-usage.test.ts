import { describe, it, expect } from "vitest";
import { rollupByDevice } from "./credit-usage";

describe("rollupByDevice", () => {
  it("sums settle credits per device and totals", () => {
    const r = rollupByDevice([
      { deviceId: "dev_a", credits: 1 },
      { deviceId: "dev_a", credits: 1 },
      { deviceId: "dev_b", credits: 1 },
    ]);
    expect(r.total).toBe(3);
    expect(r.byDevice).toEqual([
      { deviceId: "dev_a", credits: 2, count: 2 },
      { deviceId: "dev_b", credits: 1, count: 1 },
    ]);
  });

  it("returns zero total and empty byDevice for empty input", () => {
    const r = rollupByDevice([]);
    expect(r.total).toBe(0);
    expect(r.byDevice).toEqual([]);
  });

  it("groups null deviceId under 'unknown'", () => {
    const r = rollupByDevice([
      { deviceId: null, credits: 2 },
      { deviceId: null, credits: 3 },
    ]);
    expect(r.total).toBe(5);
    expect(r.byDevice).toEqual([{ deviceId: "unknown", credits: 5, count: 2 }]);
  });
});

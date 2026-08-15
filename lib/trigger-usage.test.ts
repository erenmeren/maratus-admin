import { describe, it, expect } from "vitest";
import { rollupTriggersByDevice } from "./trigger-usage";

describe("rollupTriggersByDevice", () => {
  it("counts triggers per device and totals", () => {
    const r = rollupTriggersByDevice([
      { deviceId: "dev_a" },
      { deviceId: "dev_a" },
      { deviceId: "dev_b" },
    ]);
    expect(r.total).toBe(3);
    expect(r.byDevice).toEqual([
      { deviceId: "dev_a", count: 2 },
      { deviceId: "dev_b", count: 1 },
    ]);
  });

  it("returns zero total and empty byDevice for empty input", () => {
    const r = rollupTriggersByDevice([]);
    expect(r.total).toBe(0);
    expect(r.byDevice).toEqual([]);
  });

  it("groups null deviceId under 'unknown'", () => {
    const r = rollupTriggersByDevice([{ deviceId: null }, { deviceId: null }]);
    expect(r.total).toBe(2);
    expect(r.byDevice).toEqual([{ deviceId: "unknown", count: 2 }]);
  });
});

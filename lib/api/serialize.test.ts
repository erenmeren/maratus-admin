import { describe, it, expect } from "vitest";
import { serializeUsage } from "./serialize";

describe("serializeUsage", () => {
  it("passes through activations + period as machine keys", () => {
    const u = {
      activationsThisMonth: 48,
      period: { start: "2026-07-01T00:00:00.000Z", end: "2026-08-01T00:00:00.000Z" },
    };
    expect(serializeUsage(u)).toEqual({
      activations_this_month: 48,
      period: { start: "2026-07-01T00:00:00.000Z", end: "2026-08-01T00:00:00.000Z" },
    });
  });
});

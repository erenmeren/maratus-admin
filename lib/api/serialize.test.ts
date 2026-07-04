import { describe, it, expect } from "vitest";
import { serializeUsage } from "./serialize";

describe("serializeUsage", () => {
  it("passes through credit balance + machine keys", () => {
    const u = {
      credits: { available: 120, held: 2 },
      creditsConsumedThisMonth: 48,
      activationsThisMonth: 48,
      period: { start: "2026-07-01T00:00:00.000Z", end: "2026-08-01T00:00:00.000Z" },
    };
    expect(serializeUsage(u)).toEqual({
      credits: { available: 120, held: 2 },
      credits_consumed_this_month: 48,
      activations_this_month: 48,
      period: { start: "2026-07-01T00:00:00.000Z", end: "2026-08-01T00:00:00.000Z" },
    });
  });
});

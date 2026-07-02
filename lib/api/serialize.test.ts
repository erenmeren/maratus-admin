import { describe, it, expect } from "vitest";
import { serializeUsage } from "./serialize";

describe("serializeUsage", () => {
  it("passes through integer cents + machine keys", () => {
    const out = serializeUsage({
      unitPriceCents: 4, documentsThisMonth: 10,
      currentPeriod: { start: "2026-06-01T00:00:00.000Z", end: "2026-07-01T00:00:00.000Z", documentCount: 10, amountDueCents: 40 },
      daily: [{ date: "2026-06-01", documents: 3 }],
      monthly: [{ month: "2026-06", documents: 10 }],
    });
    expect(out.unit_price_cents).toBe(4);
    expect(out.current_period.amount_due_cents).toBe(40);
    expect(out.daily[0]).toEqual({ date: "2026-06-01", documents: 3 });
  });
});

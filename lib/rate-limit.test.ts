import { describe, it, expect } from "vitest";
// Import ONLY the pure window module — the DB-backed lib/rate-limit.ts (which
// imports lib/db) must never be pulled into the unit tests.
import { computeWindowStart, decide } from "./rate-limit-window";

describe("computeWindowStart", () => {
  it("buckets every instant in a window to the same start", () => {
    expect(computeWindowStart(0, 1000)).toBe(0);
    expect(computeWindowStart(1, 1000)).toBe(0);
    expect(computeWindowStart(999, 1000)).toBe(0);
  });

  it("rolls to the next bucket exactly at the window boundary", () => {
    expect(computeWindowStart(1000, 1000)).toBe(1000);
    expect(computeWindowStart(1001, 1000)).toBe(1000);
    expect(computeWindowStart(2500, 1000)).toBe(2000);
  });
});

describe("decide", () => {
  const limit = 5;
  const windowMs = 1000;

  it("allows hits up to and including the limit", () => {
    for (let count = 1; count <= limit; count++) {
      expect(decide(count, limit, 0, windowMs, 0).allowed).toBe(true);
    }
  });

  it("blocks over the limit and reports time until the window rolls over", () => {
    const sixth = decide(6, limit, 0, windowMs, 100);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterMs).toBe(900);
  });

  it("reports zero retryAfter while allowed", () => {
    expect(decide(3, limit, 0, windowMs, 100).retryAfterMs).toBe(0);
  });

  it("resets once the window rolls over (count returns to 1 in the new bucket)", () => {
    const windowStart = computeWindowStart(1001, windowMs); // 1000
    const first = decide(1, limit, windowStart, windowMs, 1001);
    expect(first.allowed).toBe(true);
    expect(first.retryAfterMs).toBe(0);
  });
});

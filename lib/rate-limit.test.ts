import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, __resetRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => __resetRateLimit());

  it("allows up to the limit within the window", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("k", { limit: 5, windowMs: 1000, now: 0 }).allowed).toBe(true);
    }
  });

  it("blocks the request over the limit and reports retryAfter", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("k", { limit: 5, windowMs: 1000, now: 0 });
    const sixth = checkRateLimit("k", { limit: 5, windowMs: 1000, now: 100 });
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterMs).toBe(900);
  });

  it("isolates separate keys", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("a", { limit: 5, windowMs: 1000, now: 0 });
    expect(checkRateLimit("b", { limit: 5, windowMs: 1000, now: 0 }).allowed).toBe(true);
  });

  it("frees capacity after the window slides past old hits", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("k", { limit: 5, windowMs: 1000, now: 0 });
    expect(checkRateLimit("k", { limit: 5, windowMs: 1000, now: 1001 }).allowed).toBe(true);
  });
});

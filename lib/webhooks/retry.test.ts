import { describe, it, expect } from "vitest";
import { nextBackoff, MAX_ATTEMPTS } from "./retry";

describe("nextBackoff", () => {
  it("follows the escalating schedule by attempt count", () => {
    expect(nextBackoff(1)).toBe(60_000);
    expect(nextBackoff(2)).toBe(5 * 60_000);
    expect(nextBackoff(3)).toBe(30 * 60_000);
    expect(nextBackoff(4)).toBe(2 * 3_600_000);
    expect(nextBackoff(5)).toBe(6 * 3_600_000);
    expect(nextBackoff(6)).toBe(24 * 3_600_000);
  });
  it("returns null once the cap is reached", () => {
    expect(nextBackoff(7)).toBeNull();
    expect(nextBackoff(99)).toBeNull();
  });
  it("MAX_ATTEMPTS is schedule length + 1", () => {
    expect(MAX_ATTEMPTS).toBe(7);
  });
});

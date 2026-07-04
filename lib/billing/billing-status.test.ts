import { describe, it, expect } from "vitest";
import { isSuspended } from "./billing-status";

describe("isSuspended", () => {
  it("suspends on canceled/unpaid/incomplete_expired", () => {
    expect(isSuspended("canceled")).toBe(true);
    expect(isSuspended("unpaid")).toBe(true);
    expect(isSuspended("incomplete_expired")).toBe(true);
  });
  it("allows null/active/past_due/trialing", () => {
    expect(isSuspended(null)).toBe(false);
    expect(isSuspended("active")).toBe(false);
    expect(isSuspended("past_due")).toBe(false);
    expect(isSuspended("trialing")).toBe(false);
  });
});

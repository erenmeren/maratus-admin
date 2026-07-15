import { describe, it, expect } from "vitest";
import { shouldMoveCredits } from "./trigger-ack";

describe("shouldMoveCredits", () => {
  it("moves credits for a credit-billed trigger", () => {
    expect(shouldMoveCredits({ type: "trigger", billing: "credits" })).toBe(true);
  });
  it("moves credits for a legacy (null billing) trigger", () => {
    expect(shouldMoveCredits({ type: "trigger", billing: null })).toBe(true);
  });
  it("does NOT move credits for a plan-included trigger", () => {
    expect(shouldMoveCredits({ type: "trigger", billing: "included" })).toBe(false);
  });
  it("does NOT move credits for a non-trigger command", () => {
    expect(shouldMoveCredits({ type: "reboot", billing: null })).toBe(false);
  });
});

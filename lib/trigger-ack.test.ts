// lib/trigger-ack.test.ts
import { describe, it, expect } from "vitest";
import { shouldMoveCredits } from "./trigger-ack";

describe("shouldMoveCredits", () => {
  it("moves credits for credit-billed triggers (incl. legacy null billing)", () => {
    expect(shouldMoveCredits({ type: "trigger", billing: "credits" })).toBe(true);
    expect(shouldMoveCredits({ type: "trigger", billing: null })).toBe(true);
  });
  it("does not move credits for included triggers", () => {
    expect(shouldMoveCredits({ type: "trigger", billing: "included" })).toBe(false);
  });
  it("does not move credits for pin commands — the spend was immediate, an ack must not settle anything", () => {
    expect(shouldMoveCredits({ type: "pin", billing: null })).toBe(false);
  });
});

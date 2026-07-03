import { describe, it, expect } from "vitest";
import { STARTER_CREDITS } from "./credits";

describe("starter grant", () => {
  it("grants a fixed positive allotment", () => {
    expect(STARTER_CREDITS).toBe(50);
    expect(STARTER_CREDITS).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "vitest";
import { isValidCommandType, COMMAND_TYPES } from "./device-commands";

describe("isValidCommandType", () => {
  it("accepts the known types", () => {
    for (const t of COMMAND_TYPES) expect(isValidCommandType(t)).toBe(true);
  });
  it("rejects unknown", () => {
    expect(isValidCommandType("shutdown")).toBe(false);
    expect(isValidCommandType("")).toBe(false);
  });
  it("accepts config-changed", () => {
    expect(isValidCommandType("config-changed")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { normalizeEmail } from "./normalize";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Jane@Example.COM ")).toBe("jane@example.com");
  });
  it("rejects strings without a single @ and a dotted domain", () => {
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("a@@b.com")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });
  it("accepts a normal address", () => {
    expect(normalizeEmail("sam.smith+tag@mail.co.uk")).toBe("sam.smith+tag@mail.co.uk");
  });
});

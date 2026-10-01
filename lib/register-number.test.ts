import { describe, it, expect } from "vitest";
import { parseRegisterNumber, registerKey, isUniqueViolation } from "./register-number";

describe("parseRegisterNumber", () => {
  it("trims and keeps case", () => {
    expect(parseRegisterNumber("  Kasa-01 ")).toEqual({ ok: true, value: "Kasa-01" });
  });
  it("treats empty / whitespace / nullish as null", () => {
    expect(parseRegisterNumber("")).toEqual({ ok: true, value: null });
    expect(parseRegisterNumber("   ")).toEqual({ ok: true, value: null });
    expect(parseRegisterNumber(null)).toEqual({ ok: true, value: null });
    expect(parseRegisterNumber(undefined)).toEqual({ ok: true, value: null });
  });
  it("accepts letters digits . _ -", () => {
    expect(parseRegisterNumber("IST.01_K-2")).toEqual({ ok: true, value: "IST.01_K-2" });
  });
  it("rejects slash, inner space, unicode", () => {
    for (const bad of ["a/b", "a b", "kasa№1", "ğüş"]) {
      expect(parseRegisterNumber(bad).ok).toBe(false);
    }
  });
  it("rejects 41 chars, accepts 40", () => {
    expect(parseRegisterNumber("a".repeat(40)).ok).toBe(true);
    expect(parseRegisterNumber("a".repeat(41)).ok).toBe(false);
  });
});

describe("registerKey", () => {
  it("is case-insensitive", () => {
    expect(registerKey("K1")).toBe(registerKey("k1"));
  });
});

describe("isUniqueViolation", () => {
  it("detects 23505 directly and via cause", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
    expect(isUniqueViolation({ code: "42P01" })).toBe(false);
    expect(isUniqueViolation(new Error("x"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

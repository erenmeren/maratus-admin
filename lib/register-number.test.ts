import { describe, it, expect } from "vitest";
import { parseRegisterNumber, registerKey, isUniqueViolation, uniqueViolationConstraint } from "./register-number";

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
  it("pins exact behavior", () => {
    expect(registerKey("K1")).toBe("k1");
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
  it("handles cyclic cause without stack overflow", () => {
    const e: { cause?: unknown } = {};
    e.cause = e;
    expect(isUniqueViolation(e)).toBe(false);
  });
  it("nested non-23505 code returns false", () => {
    expect(isUniqueViolation({ cause: { cause: { code: "42P01" } } })).toBe(false);
  });
});

describe("uniqueViolationConstraint", () => {
  it("reads constraint on the node", () => {
    expect(uniqueViolationConstraint({ code: "23505", constraint: "a_idx" })).toBe("a_idx");
  });
  it("reads constraint on cause", () => {
    expect(uniqueViolationConstraint({ cause: { code: "23505", constraint: "b_idx" } })).toBe("b_idx");
  });
  it("parses the name from the message", () => {
    expect(
      uniqueViolationConstraint({
        code: "23505",
        message: 'duplicate key value violates unique constraint "device_org_register_number_idx"',
      }),
    ).toBe("device_org_register_number_idx");
  });
  it("returns null for non-23505", () => {
    expect(uniqueViolationConstraint({ code: "23503", constraint: "x" })).toBeNull();
    expect(uniqueViolationConstraint(new Error("boom"))).toBeNull();
  });
  it("returns null for a cyclic cause", () => {
    const e: { cause?: unknown } = {};
    e.cause = e;
    expect(uniqueViolationConstraint(e)).toBeNull();
  });
  it("ignores column names in a DrizzleQueryError-shaped message", () => {
    expect(
      uniqueViolationConstraint({
        message: 'Failed query: insert into "device" ("register_number") values ($1)',
        cause: { code: "23505", constraint: "device_pairing_code_idx" },
      }),
    ).toBe("device_pairing_code_idx");
  });
});

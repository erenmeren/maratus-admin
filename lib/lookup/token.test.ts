import { describe, it, expect } from "vitest";
import { generateLookupToken, isLookupValid, LOOKUP_TTL_MS } from "./token";
import { hashLookupToken } from "@/lib/ids";

describe("lookup token", () => {
  it("generates a raw token whose hash matches hashLookupToken", () => {
    const { raw, hash } = generateLookupToken();
    expect(raw.length).toBeGreaterThan(20);
    expect(hash).toBe(hashLookupToken(raw));
    expect(hash).not.toBe(raw);
  });

  it("is valid before expiry and unconsumed", () => {
    const now = new Date("2026-06-30T12:00:00Z");
    const expiresAt = new Date(now.getTime() + LOOKUP_TTL_MS);
    expect(isLookupValid({ expiresAt, consumedAt: null }, now)).toBe(true);
  });

  it("is invalid once expired", () => {
    const now = new Date("2026-06-30T12:31:00Z");
    const expiresAt = new Date("2026-06-30T12:00:00Z");
    expect(isLookupValid({ expiresAt, consumedAt: null }, now)).toBe(false);
  });

  it("is invalid once consumed", () => {
    const now = new Date("2026-06-30T12:00:00Z");
    const expiresAt = new Date(now.getTime() + LOOKUP_TTL_MS);
    expect(isLookupValid({ expiresAt, consumedAt: new Date(now) }, now)).toBe(false);
  });
});

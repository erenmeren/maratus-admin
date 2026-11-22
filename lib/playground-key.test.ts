import { describe, it, expect } from "vitest";
import { playgroundScopes, playgroundAllowed, isApiKeyExpired } from "./playground-key";
import { API_SCOPES } from "./api-scopes";

describe("playgroundScopes", () => {
  it("gives owners and admins every API scope", () => {
    expect(playgroundScopes("owner")).toEqual([...API_SCOPES]);
    expect(playgroundScopes("admin")).toEqual([...API_SCOPES]);
  });
  it("gives members read-only usage", () => {
    expect(playgroundScopes("member")).toEqual(["usage:read"]);
  });
  it("gives developers every API scope", () => {
    expect(playgroundScopes("developer")).toEqual([...API_SCOPES]);
  });
  it("falls back to read-only for unknown/missing roles", () => {
    expect(playgroundScopes(null)).toEqual(["usage:read"]);
    expect(playgroundScopes(undefined)).toEqual(["usage:read"]);
    expect(playgroundScopes("platform_admin")).toEqual(["usage:read"]);
  });
  it("returns a fresh array (callers can't mutate API_SCOPES)", () => {
    const s = playgroundScopes("owner");
    s.pop();
    expect(playgroundScopes("owner")).toEqual([...API_SCOPES]);
  });
});

describe("playgroundAllowed", () => {
  it("allows roles that can view the API section", () => {
    for (const r of ["owner", "admin", "member", "developer"]) expect(playgroundAllowed(r)).toBe(true);
  });
  it("denies roles without API access", () => {
    for (const r of ["designer", "operations", "billing", null, undefined]) expect(playgroundAllowed(r)).toBe(false);
  });
});

describe("isApiKeyExpired", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  it("never expires a normal key (null expiresAt)", () => {
    expect(isApiKeyExpired(null, now)).toBe(false);
    expect(isApiKeyExpired(undefined, now)).toBe(false);
  });
  it("is live strictly before expiresAt", () => {
    expect(isApiKeyExpired(new Date("2026-09-30T12:00:01Z"), now)).toBe(false);
  });
  it("is expired at and after expiresAt", () => {
    expect(isApiKeyExpired(new Date("2026-09-30T12:00:00Z"), now)).toBe(true);
    expect(isApiKeyExpired(new Date("2026-09-30T11:00:00Z"), now)).toBe(true);
  });
});

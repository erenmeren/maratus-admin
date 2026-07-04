import { describe, it, expect } from "vitest";
import { hasScope, sanitizeScopes, DEFAULT_KEY_SCOPES, API_SCOPES } from "./api-scopes";

describe("api scopes", () => {
  it("DEFAULT_KEY_SCOPES is read-only (no devices:trigger)", () => {
    expect(DEFAULT_KEY_SCOPES).toEqual(["usage:read"]);
    expect(DEFAULT_KEY_SCOPES).not.toContain("devices:trigger");
  });
  it("hasScope is true only when present", () => {
    expect(hasScope(["devices:trigger"], "devices:trigger")).toBe(true);
    expect(hasScope(["usage:read"], "devices:trigger")).toBe(false);
    expect(hasScope([], "devices:trigger")).toBe(false);
  });
  it("sanitizeScopes keeps only known scopes, dedupes, drops junk", () => {
    expect(sanitizeScopes(["devices:trigger", "devices:trigger", "nope", 5 as never]))
      .toEqual(["devices:trigger"]);
    expect(sanitizeScopes("notanarray" as never)).toEqual([]);
    expect(new Set(API_SCOPES).has("usage:read")).toBe(true);
  });
});

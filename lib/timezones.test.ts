import { describe, it, expect } from "vitest";
import { TIMEZONES, isValidTimezone, normalizeTimezone } from "./timezones";

describe("TIMEZONES", () => {
  it("includes UTC and common US zones", () => {
    const values = TIMEZONES.map((t) => t.value);
    expect(values).toContain("UTC");
    expect(values).toContain("America/Los_Angeles");
    expect(values).toContain("America/New_York");
  });
  it("has unique values", () => {
    const values = TIMEZONES.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("isValidTimezone", () => {
  it("accepts listed zones", () => {
    expect(isValidTimezone("America/Los_Angeles")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
  });
  it("rejects unlisted or garbage zones", () => {
    expect(isValidTimezone("Mars/Phobos")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("'; DROP TABLE store;--")).toBe(false);
  });
});

describe("normalizeTimezone", () => {
  it("passes valid zones through", () => {
    expect(normalizeTimezone("Europe/London")).toBe("Europe/London");
  });
  it("falls back to UTC for invalid/empty/null", () => {
    expect(normalizeTimezone("nope")).toBe("UTC");
    expect(normalizeTimezone("")).toBe("UTC");
    expect(normalizeTimezone(null)).toBe("UTC");
    expect(normalizeTimezone(undefined)).toBe("UTC");
  });
});

import { describe, it, expect } from "vitest";
import { TIMEZONES, isValidTimezone, normalizeTimezone } from "./timezones";
import { ianaToPosix } from "./posix-tz";

describe("TIMEZONES", () => {
  it("includes UTC and common US zones", () => {
    const values = TIMEZONES.map((t) => t.value);
    expect(values).toContain("UTC");
    expect(values).toContain("America/Los_Angeles");
    expect(values).toContain("America/New_York");
  });
  it("covers the regions customers actually operate in", () => {
    const values = TIMEZONES.map((t) => t.value);
    expect(values).toContain("Europe/Istanbul");
    expect(values).toContain("Asia/Shanghai");
    expect(values).toContain("America/Sao_Paulo");
    expect(values).toContain("Africa/Johannesburg");
    expect(values).toContain("Pacific/Auckland");
  });
  it("has unique values", () => {
    const values = TIMEZONES.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
  });
  it("has unique, non-empty labels", () => {
    const labels = TIMEZONES.map((t) => t.label);
    for (const label of labels) expect(label.trim().length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });

  // The two files carry a hand-maintained parity contract (see both headers).
  // A zone in the picker with no POSIX mapping would silently ship "UTC0" to the
  // device, so its on-screen clock would be wrong with no error anywhere.
  it("maps every zone to a POSIX TZ string (lib/posix-tz.ts parity)", () => {
    for (const { value } of TIMEZONES) {
      const posix = ianaToPosix(value);
      if (value === "UTC") {
        expect(posix).toBe("UTC0");
      } else {
        expect(
          posix,
          `${value} has no entry in lib/posix-tz.ts (fell back to UTC0)`,
        ).not.toBe("UTC0");
      }
    }
  });

  it("only lists zones the tz database actually knows", () => {
    for (const { value } of TIMEZONES) {
      expect(
        () => new Intl.DateTimeFormat(undefined, { timeZone: value }),
        `${value} is not a real IANA zone`,
      ).not.toThrow();
    }
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

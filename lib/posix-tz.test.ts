import { describe, it, expect } from "vitest";
import { ianaToPosix } from "./posix-tz";
import { TIMEZONES } from "./timezones";

describe("ianaToPosix", () => {
  it("maps every curated timezone to a real POSIX string (no silent UTC0 fallback)", () => {
    for (const { value } of TIMEZONES) {
      const result = ianaToPosix(value);
      expect(result, value).toMatch(/.+/);
      if (value !== "UTC") {
        expect(result, `${value} is missing a real mapping (fell back to UTC0)`).not.toBe("UTC0");
      }
    }
  });

  it("maps a DST zone correctly (America/New_York)", () => {
    expect(ianaToPosix("America/New_York")).toBe("EST5EDT,M3.2.0,M11.1.0");
  });

  it("maps a no-DST zone correctly (Asia/Kolkata)", () => {
    expect(ianaToPosix("Asia/Kolkata")).toBe("IST-5:30");
  });

  it("maps UTC", () => {
    expect(ianaToPosix("UTC")).toBe("UTC0");
  });

  it("maps a EU DST zone correctly (Europe/London)", () => {
    expect(ianaToPosix("Europe/London")).toBe("GMT0BST,M3.5.0/1,M10.5.0");
  });

  it("maps a southern-hemisphere DST zone correctly (Australia/Sydney)", () => {
    expect(ianaToPosix("Australia/Sydney")).toBe("AEST-10AEDT,M10.1.0,M4.1.0/3");
  });

  it("falls back to UTC0 for unknown or empty input", () => {
    expect(ianaToPosix("Mars/Olympus_Mons")).toBe("UTC0");
    expect(ianaToPosix("")).toBe("UTC0");
  });
});

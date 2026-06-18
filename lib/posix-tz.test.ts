import { describe, it, expect } from "vitest";
import { ianaToPosix } from "./posix-tz";
import { TIMEZONES } from "./timezones";

describe("ianaToPosix", () => {
  it("maps every curated timezone to a non-empty POSIX string", () => {
    for (const { value } of TIMEZONES) {
      expect(ianaToPosix(value), value).toMatch(/.+/);
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

  it("falls back to UTC0 for unknown or empty input", () => {
    expect(ianaToPosix("Mars/Olympus_Mons")).toBe("UTC0");
    expect(ianaToPosix("")).toBe("UTC0");
  });
});

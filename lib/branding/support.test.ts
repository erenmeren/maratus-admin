import { describe, it, expect } from "vitest";
import { isLikelyEmail, isHttpUrl, supportLinks } from "./support";

describe("isLikelyEmail", () => {
  it("accepts a normal address", () => {
    expect(isLikelyEmail("help@roastwell.co")).toBe(true);
  });
  it("rejects missing @ or dot-after-@", () => {
    expect(isLikelyEmail("helproastwell.co")).toBe(false);
    expect(isLikelyEmail("help@localhost")).toBe(false);
    expect(isLikelyEmail("")).toBe(false);
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("https://roastwell.co/returns")).toBe(true);
    expect(isHttpUrl("http://x.test")).toBe(true);
  });
  it("rejects non-http(s) or bare domains", () => {
    expect(isHttpUrl("roastwell.co")).toBe(false);
    expect(isHttpUrl("ftp://x")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("supportLinks", () => {
  it("shows both when both valid", () => {
    expect(supportLinks({ supportEmail: "help@x.co", supportUrl: "https://x.co/h" })).toEqual({
      email: "help@x.co",
      url: "https://x.co/h",
      show: true,
    });
  });
  it("trims and drops invalid values", () => {
    expect(supportLinks({ supportEmail: "  help@x.co  ", supportUrl: "not-a-url" })).toEqual({
      email: "help@x.co",
      url: null,
      show: true,
    });
  });
  it("show:false when both blank/invalid", () => {
    expect(supportLinks({ supportEmail: null, supportUrl: "" })).toEqual({
      email: null,
      url: null,
      show: false,
    });
  });
});

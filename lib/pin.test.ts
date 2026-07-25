import { describe, it, expect } from "vitest";
import { validatePinBody, PIN_URL_MAX_LENGTH, validatePinPutBody } from "./pin";

describe("validatePinBody", () => {
  it("accepts a valid https url", () => {
    expect(validatePinBody({ url: "https://example.com/menu" })).toEqual({
      ok: true,
      url: "https://example.com/menu",
    });
  });
  it("accepts http", () => {
    expect(validatePinBody({ url: "http://example.com" }).ok).toBe(true);
  });
  it("rejects non-object bodies", () => {
    expect(validatePinBody("https://example.com").ok).toBe(false);
    expect(validatePinBody(null).ok).toBe(false);
  });
  it("rejects a missing or empty url", () => {
    expect(validatePinBody({}).ok).toBe(false);
    expect(validatePinBody({ url: "" }).ok).toBe(false);
    expect(validatePinBody({ url: 42 }).ok).toBe(false);
  });
  it("rejects non-http(s) schemes", () => {
    expect(validatePinBody({ url: "javascript:alert(1)" }).ok).toBe(false);
    expect(validatePinBody({ url: "ftp://example.com" }).ok).toBe(false);
  });
  it("rejects relative urls", () => {
    expect(validatePinBody({ url: "/menu" }).ok).toBe(false);
  });
  it("rejects oversize urls", () => {
    const url = "https://example.com/" + "a".repeat(PIN_URL_MAX_LENGTH);
    expect(validatePinBody({ url }).ok).toBe(false);
  });
});

describe("validatePinPutBody", () => {
  it("accepts {url} and reuses url validation", () => {
    expect(validatePinPutBody({ url: "https://x.co/m" })).toEqual({
      ok: true, kind: "url", url: "https://x.co/m",
    });
    expect(validatePinPutBody({ url: "ftp://x.co" }).ok).toBe(false);
  });
  it("accepts {mode:'none'} and {mode:'inherit'}", () => {
    expect(validatePinPutBody({ mode: "none" })).toEqual({ ok: true, kind: "mode", mode: "none" });
    expect(validatePinPutBody({ mode: "inherit" })).toEqual({ ok: true, kind: "mode", mode: "inherit" });
  });
  it("rejects mode:'custom' (custom is expressed by sending a url)", () => {
    expect(validatePinPutBody({ mode: "custom" }).ok).toBe(false);
  });
  it("rejects both url and mode together", () => {
    expect(validatePinPutBody({ url: "https://x.co", mode: "none" }).ok).toBe(false);
  });
  it("rejects mode when allowMode is false (org scope)", () => {
    expect(validatePinPutBody({ mode: "none" }, { allowMode: false }).ok).toBe(false);
  });
  it("rejects empty objects and non-objects", () => {
    expect(validatePinPutBody({}).ok).toBe(false);
    expect(validatePinPutBody(null).ok).toBe(false);
  });
});

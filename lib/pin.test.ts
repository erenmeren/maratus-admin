import { describe, it, expect } from "vitest";
import { validatePinBody, PIN_URL_MAX_LENGTH } from "./pin";

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

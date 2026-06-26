import { describe, it, expect } from "vitest";
import { validateTriggerBody, creditCostForAction } from "./trigger-actions";

describe("validateTriggerBody", () => {
  it("accepts show_qr with an https url", () => {
    const r = validateTriggerBody({ action: "show_qr", payload: { url: "https://x.co/r/abc" } });
    expect(r).toEqual({ ok: true, action: "show_qr", payload: { url: "https://x.co/r/abc" } });
  });
  it("rejects unknown action", () => {
    expect(validateTriggerBody({ action: "explode", payload: {} }).ok).toBe(false);
  });
  it("rejects show_qr without a valid url", () => {
    expect(validateTriggerBody({ action: "show_qr", payload: {} }).ok).toBe(false);
    expect(validateTriggerBody({ action: "show_qr", payload: { url: "ftp://x" } }).ok).toBe(false);
    expect(validateTriggerBody({ action: "show_qr", payload: { url: "x".repeat(3000) } }).ok).toBe(false);
  });
  it("rejects non-object body", () => {
    expect(validateTriggerBody(null).ok).toBe(false);
    expect(validateTriggerBody("nope").ok).toBe(false);
  });
  it("creditCostForAction returns 1 for show_qr", () => {
    expect(creditCostForAction("show_qr")).toBe(1);
  });
});

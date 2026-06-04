import { describe, it, expect } from "vitest";
import { emailVerificationEnabled } from "./email-verification";

describe("emailVerificationEnabled", () => {
  it("is enabled only when a Resend API key is present", () => {
    expect(emailVerificationEnabled("re_live_xxx")).toBe(true);
  });
  it("is disabled when the key is missing or empty", () => {
    expect(emailVerificationEnabled(undefined)).toBe(false);
    expect(emailVerificationEnabled("")).toBe(false);
    expect(emailVerificationEnabled("   ")).toBe(false);
  });
});

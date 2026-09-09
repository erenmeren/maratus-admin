// lib/auth-hooks.test.ts
import { describe, expect, it } from "vitest";
import { decideHttpSignUp, pinAuthCallbacks } from "./auth-hooks";

describe("pinAuthCallbacks", () => {
  it("forces redirectTo on password-reset requests, whatever the caller sent", () => {
    expect(
      pinAuthCallbacks("/request-password-reset", { email: "a@b.co", redirectTo: "https://evil.vercel.app/x" }),
    ).toEqual({ email: "a@b.co", redirectTo: "/reset-password" });
  });
  it("forces callbackURL on verification-email requests", () => {
    expect(pinAuthCallbacks("/send-verification-email", { email: "a@b.co", callbackURL: "https://evil.vercel.app" }))
      .toEqual({ email: "a@b.co", callbackURL: "/tenant" });
  });
  it("forces callbackURL on sign-up (the verification mail it sends)", () => {
    expect(pinAuthCallbacks("/sign-up/email", { email: "a@b.co", name: "A", password: "x", callbackURL: "//evil" }))
      .toEqual({ email: "a@b.co", name: "A", password: "x", callbackURL: "/tenant" });
  });
  it("returns null for every other path", () => {
    expect(pinAuthCallbacks("/sign-in/email", { email: "a@b.co" })).toBeNull();
  });
  it("tolerates a missing body", () => {
    expect(pinAuthCallbacks("/request-password-reset", undefined)).toEqual({ redirectTo: "/reset-password" });
  });
});

describe("decideHttpSignUp", () => {
  it("blocks sign-up that arrived over HTTP", () => {
    expect(decideHttpSignUp({ isHttpRequest: true })).toEqual({ ok: false, reason: "http_signup_disabled" });
  });
  it("allows the server-side acceptInviteSignup call", () => {
    expect(decideHttpSignUp({ isHttpRequest: false })).toEqual({ ok: true });
  });
});

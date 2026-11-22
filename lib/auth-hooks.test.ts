// lib/auth-hooks.test.ts
import { describe, expect, it } from "vitest";
import { decideHttpSignUp, isOrgReadPath, isOrgReadPathBlocked, pinAuthCallbacks, resolveGuardedOrg } from "./auth-hooks";

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

describe("isOrgReadPathBlocked", () => {
  it("blocks member/invitation reads for roles that cannot view Members", () => {
    expect(isOrgReadPathBlocked("/organization/list-members", "designer")).toBe(true);
    expect(isOrgReadPathBlocked("/organization/get-full-organization", "billing")).toBe(true);
    expect(isOrgReadPathBlocked("/organization/list-invitations", "developer")).toBe(true);
    expect(isOrgReadPathBlocked("/organization/list-members", null)).toBe(true);
    expect(isOrgReadPathBlocked("/organization/get-active-member-role", "operations")).toBe(true);
  });
  it("allows roles that can view Members", () => {
    expect(isOrgReadPathBlocked("/organization/list-members", "member")).toBe(false);
    expect(isOrgReadPathBlocked("/organization/list-invitations", "admin")).toBe(false);
  });
  it("ignores every other path", () => {
    expect(isOrgReadPathBlocked("/organization/set-active", "designer")).toBe(false);
  });
});

describe("isOrgReadPath", () => {
  it("matches only the three member/invitation read routes", () => {
    expect(isOrgReadPath("/organization/list-members")).toBe(true);
    expect(isOrgReadPath("/organization/get-full-organization")).toBe(true);
    expect(isOrgReadPath("/organization/list-invitations")).toBe(true);
    expect(isOrgReadPath("/organization/set-active")).toBe(false);
  });
});

describe("resolveGuardedOrg", () => {
  it("ignores organizationSlug on list-invitations (the plugin does)", () => {
    expect(resolveGuardedOrg("/organization/list-invitations", { organizationSlug: "other" }, "active"))
      .toEqual({ kind: "id", value: "active" });
    expect(resolveGuardedOrg("/organization/list-invitations", { organizationSlug: "other", organizationId: "o1" }, "active"))
      .toEqual({ kind: "id", value: "o1" });
  });
  it("lets organizationSlug win on list-members and get-full-organization", () => {
    for (const path of ["/organization/list-members", "/organization/get-full-organization"]) {
      expect(resolveGuardedOrg(path, { organizationSlug: "s", organizationId: "o1" }, "active"))
        .toEqual({ kind: "slug", value: "s" });
      expect(resolveGuardedOrg(path, { organizationId: "o1" }, "active")).toEqual({ kind: "id", value: "o1" });
      expect(resolveGuardedOrg(path, {}, "active")).toEqual({ kind: "id", value: "active" });
    }
  });
  it("falls through empty strings like the plugin's ||", () => {
    expect(resolveGuardedOrg("/organization/list-members", { organizationSlug: "", organizationId: "" }, "active"))
      .toEqual({ kind: "id", value: "active" });
    expect(resolveGuardedOrg("/organization/list-invitations", { organizationId: "" }, "active"))
      .toEqual({ kind: "id", value: "active" });
  });
  it("returns null when nothing identifies an org", () => {
    expect(resolveGuardedOrg("/organization/list-members", {}, null)).toBeNull();
    expect(resolveGuardedOrg("/organization/list-invitations", { organizationSlug: "s" }, null)).toBeNull();
    expect(resolveGuardedOrg("/organization/get-full-organization", undefined, "")).toBeNull();
  });
});

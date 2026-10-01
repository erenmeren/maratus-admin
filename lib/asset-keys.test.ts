// lib/asset-keys.test.ts
import { describe, expect, it } from "vitest";
import { isTenantImageKey } from "./asset-keys";

describe("isTenantImageKey", () => {
  const org = "org_abc";
  it("accepts a key under the org's images prefix", () => {
    expect(isTenantImageKey(org, "branding/org_abc/images/image_x1")).toBe(true);
  });
  it("rejects another org's prefix", () => {
    expect(isTenantImageKey(org, "branding/org_zzz/images/image_x1")).toBe(false);
  });
  it("rejects firmware and other bucket paths", () => {
    expect(isTenantImageKey(org, "firmware/0.19.1/maratus-firmware.bin")).toBe(false);
    expect(isTenantImageKey(org, "logos/org_abc/l1")).toBe(false);
  });
  it("rejects traversal, empty segments and a bare prefix", () => {
    expect(isTenantImageKey(org, "branding/org_abc/images/../../x")).toBe(false);
    expect(isTenantImageKey(org, "branding/org_abc/images/")).toBe(false);
    expect(isTenantImageKey(org, "branding/org_abc/images/a/b")).toBe(false);
  });
  it("rejects direct URLs (those are never R2 keys)", () => {
    expect(isTenantImageKey(org, "/defaults/logo.png")).toBe(false);
    expect(isTenantImageKey(org, "https://x/y")).toBe(false);
  });
});

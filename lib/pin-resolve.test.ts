import { describe, it, expect } from "vitest";
import { resolveEffectivePin } from "./pin-resolve";

const T = { pinnedUrl: "https://tenant.example/t" };
const noTenant = { pinnedUrl: null };
const inherit = { pinMode: "inherit" as const, pinnedUrl: null };

describe("resolveEffectivePin", () => {
  it("device custom wins over everything", () => {
    expect(
      resolveEffectivePin({
        device: { pinMode: "custom", pinnedUrl: "https://d.example" },
        store: { pinMode: "custom", pinnedUrl: "https://s.example" },
        tenant: T,
      }),
    ).toEqual({ url: "https://d.example", source: "device" });
  });
  it("device none suppresses store and tenant pins", () => {
    expect(
      resolveEffectivePin({
        device: { pinMode: "none", pinnedUrl: null },
        store: { pinMode: "custom", pinnedUrl: "https://s.example" },
        tenant: T,
      }),
    ).toEqual({ url: null, source: null });
  });
  it("inheriting device gets the store custom pin", () => {
    expect(
      resolveEffectivePin({
        device: inherit,
        store: { pinMode: "custom", pinnedUrl: "https://s.example" },
        tenant: T,
      }),
    ).toEqual({ url: "https://s.example", source: "store" });
  });
  it("store none suppresses the tenant pin", () => {
    expect(resolveEffectivePin({ device: inherit, store: { pinMode: "none", pinnedUrl: null }, tenant: T })).toEqual({
      url: null,
      source: null,
    });
  });
  it("full inherit chain reaches the tenant pin", () => {
    expect(resolveEffectivePin({ device: inherit, store: inherit, tenant: T })).toEqual({
      url: "https://tenant.example/t",
      source: "tenant",
    });
  });
  it("pool device (store null) inherits the tenant pin directly", () => {
    expect(resolveEffectivePin({ device: inherit, store: null, tenant: T })).toEqual({
      url: "https://tenant.example/t",
      source: "tenant",
    });
  });
  it("no pin anywhere resolves to null/null", () => {
    expect(resolveEffectivePin({ device: inherit, store: inherit, tenant: noTenant })).toEqual({
      url: null,
      source: null,
    });
  });
  it("tolerates custom with a null url (treated as no pin at that level)", () => {
    expect(
      resolveEffectivePin({ device: { pinMode: "custom", pinnedUrl: null }, store: inherit, tenant: T }),
    ).toEqual({ url: "https://tenant.example/t", source: "tenant" });
    expect(
      resolveEffectivePin({ device: inherit, store: { pinMode: "custom", pinnedUrl: null }, tenant: T }),
    ).toEqual({ url: "https://tenant.example/t", source: "tenant" });
  });
});

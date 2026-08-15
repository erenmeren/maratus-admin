import { describe, it, expect } from "vitest";
import { resolveEffectivePin, planScopedPinChange, type DevicePinRow, type StorePinRow } from "./pin-resolve";

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

describe("planScopedPinChange", () => {
  const stores: StorePinRow[] = [
    { id: "s1", pinMode: "inherit", pinnedUrl: null },
    { id: "s2", pinMode: "custom", pinnedUrl: "https://s2.example" },
    { id: "s3", pinMode: "none", pinnedUrl: null },
  ];
  const devices: DevicePinRow[] = [
    { id: "d1", storeId: "s1", pinMode: "inherit", pinnedUrl: null },   // follows tenant
    { id: "d2", storeId: "s1", pinMode: "custom", pinnedUrl: "https://d2.example" },
    { id: "d3", storeId: "s2", pinMode: "inherit", pinnedUrl: null },   // follows s2
    { id: "d4", storeId: "s3", pinMode: "inherit", pinnedUrl: null },   // suppressed by s3
    { id: "d5", storeId: null, pinMode: "inherit", pinnedUrl: null },   // pool → tenant
    { id: "d6", storeId: "s1", pinMode: "none", pinnedUrl: null },      // opted out
  ];

  it("org set reaches only devices that resolve to tenant", () => {
    const r = planScopedPinChange({
      devices, stores, tenantPinnedUrl: null,
      change: { scope: "org", url: "https://t.example" },
    });
    expect(r.affected).toEqual([
      { deviceId: "d1", newUrl: "https://t.example" },
      { deviceId: "d5", newUrl: "https://t.example" },
    ]);
  });

  it("org clear still fans out to followers", () => {
    const r = planScopedPinChange({
      devices, stores, tenantPinnedUrl: "https://t.example",
      change: { scope: "org", url: null },
    });
    expect(r.affected).toEqual([
      { deviceId: "d1", newUrl: null },
      { deviceId: "d5", newUrl: null },
    ]);
  });

  it("store url set affects only that store's inheriting devices", () => {
    const r = planScopedPinChange({
      devices, stores, tenantPinnedUrl: null,
      change: { scope: "store", storeId: "s1", mode: "custom", url: "https://new.example" },
    });
    expect(r.affected).toEqual([{ deviceId: "d1", newUrl: "https://new.example" }]);
  });

  it("same-URL devices are not affected (no-op per device)", () => {
    const r = planScopedPinChange({
      devices, stores, tenantPinnedUrl: "https://s2.example",
      change: { scope: "store", storeId: "s2", mode: "inherit", url: null },
    });
    // d3's effective stays https://s2.example (now from tenant) → not affected.
    expect(r.affected).toEqual([]);
  });

  it("store mode inherit lights up the devices it reaches with the tenant pin", () => {
    const r = planScopedPinChange({
      devices, stores, tenantPinnedUrl: "https://t.example",
      change: { scope: "store", storeId: "s3", mode: "inherit", url: null },
    });
    expect(r.affected).toEqual([{ deviceId: "d4", newUrl: "https://t.example" }]);
  });

  it("store mode inherit affects nothing when there is nothing to inherit", () => {
    const r = planScopedPinChange({
      devices, stores, tenantPinnedUrl: null,
      change: { scope: "store", storeId: "s3", mode: "inherit", url: null },
    });
    expect(r.affected).toEqual([]);
  });

  it("a mode change can swap one live URL for another", () => {
    // d2 is custom https://d2.example; dropping to inherit picks up s1 → tenant.
    const r = planScopedPinChange({
      devices, stores, tenantPinnedUrl: "https://t.example",
      change: { scope: "device", deviceId: "d2", mode: "inherit", url: null },
    });
    expect(r.affected).toEqual([{ deviceId: "d2", newUrl: "https://t.example" }]);
  });

  it("flipping a blacked-out store back to inherit reaches its devices", () => {
    const blackedOut: StorePinRow[] = stores.map((s) => ({ ...s, pinMode: "none", pinnedUrl: null }));
    const setOrgWhileDark = planScopedPinChange({
      devices, stores: blackedOut, tenantPinnedUrl: null,
      change: { scope: "org", url: "https://promo.example" },
    });
    expect(setOrgWhileDark.affected).toEqual([{ deviceId: "d5", newUrl: "https://promo.example" }]); // only the pool device d5 is reachable

    const flipBack = planScopedPinChange({
      devices, stores: blackedOut, tenantPinnedUrl: "https://promo.example",
      change: { scope: "store", storeId: "s1", mode: "inherit", url: null },
    });
    expect(flipBack.affected).toEqual([{ deviceId: "d1", newUrl: "https://promo.example" }]);
  });

  it("device url set affects exactly that device", () => {
    const r = planScopedPinChange({
      devices, stores, tenantPinnedUrl: null,
      change: { scope: "device", deviceId: "d1", mode: "custom", url: "https://d1.example" },
    });
    expect(r.affected).toEqual([{ deviceId: "d1", newUrl: "https://d1.example" }]);
  });

  it("device mode none clears its effective pin", () => {
    const r = planScopedPinChange({
      devices, stores, tenantPinnedUrl: "https://t.example",
      change: { scope: "device", deviceId: "d1", mode: "none", url: null },
    });
    expect(r.affected).toEqual([{ deviceId: "d1", newUrl: null }]);
  });

  it("device DELETE→inherit falls back through the chain", () => {
    const r = planScopedPinChange({
      devices, stores, tenantPinnedUrl: null,
      change: { scope: "device", deviceId: "d2", mode: "inherit", url: null },
    });
    // d2 was custom https://d2.example; s1 inherits and there is no tenant pin.
    expect(r.affected).toEqual([{ deviceId: "d2", newUrl: null }]);
  });
});

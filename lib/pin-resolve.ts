// lib/pin-resolve.ts
// Pure effective-pin resolution + change planning for scoped pinned QR.
// The precedence is device > store > tenant; "none" stops the chain, "custom"
// answers it, "inherit" delegates upward. Devices only ever see the resolved
// URL (spec: docs/superpowers/specs/2026-07-25-scoped-pinned-qr-design.md).

import type { PinMode } from "@/lib/pin";

export interface PinLevel {
  pinMode: PinMode;
  pinnedUrl: string | null;
}

export interface EffectivePin {
  url: string | null;
  source: "device" | "store" | "tenant" | null;
}

export function resolveEffectivePin(a: {
  device: PinLevel;
  store: PinLevel | null; // null = pool device
  tenant: { pinnedUrl: string | null };
}): EffectivePin {
  // "custom" with a null URL is tolerated data drift → treated as inherit.
  if (a.device.pinMode === "custom" && a.device.pinnedUrl !== null) {
    return { url: a.device.pinnedUrl, source: "device" };
  }
  if (a.device.pinMode === "none") return { url: null, source: null };
  if (a.store) {
    if (a.store.pinMode === "custom" && a.store.pinnedUrl !== null) {
      return { url: a.store.pinnedUrl, source: "store" };
    }
    if (a.store.pinMode === "none") return { url: null, source: null };
  }
  return a.tenant.pinnedUrl !== null
    ? { url: a.tenant.pinnedUrl, source: "tenant" }
    : { url: null, source: null };
}

export type ScopedPinChange =
  | { scope: "org"; url: string | null }
  | { scope: "store"; storeId: string; mode: PinMode; url: string | null }
  | { scope: "device"; deviceId: string; mode: PinMode; url: string | null };

export interface DevicePinRow extends PinLevel {
  id: string;
  storeId: string | null;
}
export interface StorePinRow extends PinLevel {
  id: string;
}

/** True when the change is a paid URL set (Global money rule: paid ⇔ sets a URL). */
export function changeSetsUrl(change: ScopedPinChange): boolean {
  return change.url !== null;
}

/**
 * Compute which devices' effective pin URL a scoped change would alter, and
 * how many credits it costs. Pure: callers load rows, we only do math.
 */
export function planScopedPinChange(a: {
  devices: DevicePinRow[];
  stores: StorePinRow[];
  tenantPinnedUrl: string | null;
  change: ScopedPinChange;
}): { affected: { deviceId: string; newUrl: string | null }[]; chargedCount: number } {
  const storeById = new Map(a.stores.map((s) => [s.id, s]));

  // Apply the change to a copy of the three levels.
  const nextTenantUrl = a.change.scope === "org" ? a.change.url : a.tenantPinnedUrl;
  const nextStore = (s: StorePinRow | null): PinLevel | null => {
    if (!s) return null;
    if (a.change.scope === "store" && a.change.storeId === s.id) {
      return { pinMode: a.change.mode, pinnedUrl: a.change.url };
    }
    return s;
  };
  const nextDevice = (d: DevicePinRow): PinLevel => {
    if (a.change.scope === "device" && a.change.deviceId === d.id) {
      return { pinMode: a.change.mode, pinnedUrl: a.change.url };
    }
    return d;
  };

  const affected: { deviceId: string; newUrl: string | null }[] = [];
  for (const d of a.devices) {
    const store = d.storeId ? (storeById.get(d.storeId) ?? null) : null;
    const before = resolveEffectivePin({
      device: d,
      store,
      tenant: { pinnedUrl: a.tenantPinnedUrl },
    });
    const after = resolveEffectivePin({
      device: nextDevice(d),
      store: nextStore(store),
      tenant: { pinnedUrl: nextTenantUrl },
    });
    if (before.url !== after.url) affected.push({ deviceId: d.id, newUrl: after.url });
  }
  return { affected, chargedCount: changeSetsUrl(a.change) ? affected.length : 0 };
}

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

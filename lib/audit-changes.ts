// Names of the parts a branding / device-settings save changed, for the audit
// row's metadata.changed. Names only — never values (colors, urls, the PIN).

import { PRINTER_SCREENS, SCREEN_LABEL, type PrinterConfig } from "./printer-layout";
import { DEVICE_SETTINGS_DEFAULTS, type DeviceSettings } from "./device-settings";

export interface BrandingSnapshot {
  brandColor: string | null;
  brandBg: string | null;
  brandFg: string | null;
  brandMuted: string | null;
  printerConfig: PrinterConfig | null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function brandingChanges(before: BrandingSnapshot | null, after: BrandingSnapshot): string[] {
  if (!before) return ["Initial branding"];
  const out: string[] = [];
  const colors = ["brandColor", "brandBg", "brandFg", "brandMuted"] as const;
  if (colors.some((k) => before[k] !== after[k])) out.push("Theme colors");

  const a = before.printerConfig;
  const b = after.printerConfig;
  // No config submitted on this save → only the colors could have changed.
  if (!a || !b) return out;
  const qrKeys = (Object.keys(b) as (keyof PrinterConfig)[]).filter((k) => k.startsWith("qr") && k !== "qrTimeoutSeconds");
  if (qrKeys.some((k) => !same(a[k], b[k]))) out.push("QR style");
  const statusKeys = ["clockTimezone", "clock24h", "wifiLevel", "qrTimeoutSeconds"] as const;
  if (statusKeys.some((k) => a[k] !== b[k])) out.push("Clock & status");
  for (const s of PRINTER_SCREENS) {
    if (!same(a.screens[s], b.screens[s])) out.push(`${SCREEN_LABEL[s].replace(" ✓", "")} screen`);
  }
  return out;
}

export function deviceSettingsChanges(
  before: DeviceSettings | null,
  after: DeviceSettings,
  pin: "set" | "cleared" | "unchanged",
): string[] {
  const b = before ?? DEVICE_SETTINGS_DEFAULTS;
  const out: string[] = [];
  if (b.qrVisibleSeconds !== after.qrVisibleSeconds) out.push("QR duration");
  if (b.screenBrightness !== after.screenBrightness) out.push("Brightness");
  if (b.screenSleepEnabled !== after.screenSleepEnabled || b.screenSleepTimeoutSeconds !== after.screenSleepTimeoutSeconds) {
    out.push("Screen sleep");
  }
  if (pin !== "unchanged") out.push("Settings PIN");
  return out;
}

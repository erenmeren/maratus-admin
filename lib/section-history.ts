// lib/section-history.ts
// Pure: map audit actions (lib/audit.ts AUDIT.*) to the tenant section whose
// "History" sheet shows them, the matching SQL LIKE filters, and the keyset
// cursor for getSectionHistory (lib/actions/section-history.ts). No IO.

import type { Section } from "@/lib/roles";

export type HistorySection = Exclude<Section, "dashboard" | "activity">;

export const HISTORY_SECTIONS: HistorySection[] = [
  "stores",
  "devices",
  "deviceSettings",
  "pinnedQr",
  "branding",
  "members",
  "billing",
  "api",
];

export const HISTORY_PAGE_SIZE = 20;

const PIN = ["org.pin_", "store.pin_", "device.pin_"];

// Prefixes per section. Pin prefixes are checked first in sectionForAction, so
// store.pin_* / device.pin_* go to pinnedQr, not stores/devices.
const PREFIXES: Record<HistorySection, string[]> = {
  pinnedQr: PIN,
  branding: ["branding."],
  stores: ["store."],
  devices: ["device."],
  deviceSettings: ["device_settings."],
  api: ["api_key."],
  billing: ["invoice.", "subscription.", "billing."],
  members: ["member.", "invitation."],
};

export function sectionForAction(action: string): Section | null {
  if (PIN.some((p) => action.startsWith(p))) return "pinnedQr";
  for (const s of HISTORY_SECTIONS) {
    if (PREFIXES[s].some((p) => action.startsWith(p))) return s;
  }
  return null;
}

const like = (prefix: string) => prefix.replace(/[\\%_]/g, "\\$&") + "%";

/** LIKE patterns (backslash escape) an action must match for `section`. */
export function actionPatternsFor(section: HistorySection): string[] {
  return PREFIXES[section].map(like);
}

/** LIKE patterns an action must NOT match: stores/devices drop their pin actions. */
export function actionExcludePatternsFor(section: HistorySection): string[] {
  if (section === "stores") return [like("store.pin_")];
  if (section === "devices") return [like("device.pin_")];
  return [];
}

export function encodeCursor(c: { at: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ at: c.at.toISOString(), id: c.id })).toString("base64url");
}

export function decodeCursor(s: string): { at: Date; id: string } | null {
  try {
    const v = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    const at = new Date(v?.at);
    if (typeof v?.at !== "string" || typeof v.id !== "string" || Number.isNaN(at.getTime())) return null;
    return { at, id: v.id };
  } catch {
    return null;
  }
}

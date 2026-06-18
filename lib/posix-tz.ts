// POSIX TZ strings for the curated zones in lib/timezones.ts. The device's libc
// needs a POSIX TZ string (not an IANA name) to apply DST correctly, and it has
// no on-device tz database — so we convert here, where the full tz data lives.
// Keep this map in sync with lib/timezones.ts.
const IANA_TO_POSIX: Record<string, string> = {
  UTC: "UTC0",
  "America/New_York": "EST5EDT,M3.2.0,M11.1.0",
  "America/Chicago": "CST6CDT,M3.2.0,M11.1.0",
  "America/Denver": "MST7MDT,M3.2.0,M11.1.0",
  "America/Phoenix": "MST7",
  "America/Los_Angeles": "PST8PDT,M3.2.0,M11.1.0",
  "America/Anchorage": "AKST9AKDT,M3.2.0,M11.1.0",
  "Pacific/Honolulu": "HST10",
  "America/Toronto": "EST5EDT,M3.2.0,M11.1.0",
  "America/Mexico_City": "CST6", // Mexico ended nationwide DST in 2022
  "Europe/London": "GMT0BST,M3.5.0/1,M10.5.0",
  "Europe/Paris": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Berlin": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Madrid": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Asia/Dubai": "GST-4",
  "Asia/Kolkata": "IST-5:30",
  "Asia/Singapore": "<+08>-8",
  "Asia/Tokyo": "JST-9",
  "Australia/Sydney": "AEST-10AEDT,M10.1.0,M4.1.0/3",
};

/** Convert a curated IANA zone name to a POSIX TZ string. Unknown/empty → UTC0. */
export function ianaToPosix(iana: string): string {
  return IANA_TO_POSIX[iana] ?? "UTC0";
}

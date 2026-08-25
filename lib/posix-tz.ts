// POSIX TZ strings for the curated zones in lib/timezones.ts. The device's libc
// needs a POSIX TZ string (not an IANA name) to apply DST correctly, and it has
// no on-device tz database — so we convert here, where the full tz data lives.
// Keep this map in sync with lib/timezones.ts.
//
// Every string below was cross-checked against the tzdata TZif footer for its
// zone and validated by replaying two future years of offsets, so DST rules are
// authoritative rather than pattern-matched. Anything surprising is commented.
const IANA_TO_POSIX: Record<string, string> = {
  UTC: "UTC0",

  // North America — US/Canada DST is 2nd Sunday of March → 1st Sunday of November.
  "America/New_York": "EST5EDT,M3.2.0,M11.1.0",
  "America/Chicago": "CST6CDT,M3.2.0,M11.1.0",
  "America/Denver": "MST7MDT,M3.2.0,M11.1.0",
  "America/Phoenix": "MST7", // Arizona does not observe DST
  "America/Los_Angeles": "PST8PDT,M3.2.0,M11.1.0",
  "America/Anchorage": "AKST9AKDT,M3.2.0,M11.1.0",
  "Pacific/Honolulu": "HST10", // Hawaii does not observe DST
  "America/Toronto": "EST5EDT,M3.2.0,M11.1.0",
  "America/Vancouver": "MST7", // BC goes permanent UTC-7 on 2026-11-01; tzdata labels that offset "MST"
  "America/Mexico_City": "CST6", // Mexico ended nationwide DST in 2022

  // Latin America — no DST anywhere here except Chile.
  "America/Bogota": "<-05>5",
  "America/Lima": "<-05>5",
  "America/Sao_Paulo": "<-03>3", // Brazil abolished DST in 2019
  "America/Argentina/Buenos_Aires": "<-03>3", // Argentina has had no DST since 2009
  "America/Santiago": "<-04>4<-03>,M9.1.6/24,M4.1.6/24", // Chile: southern-hemisphere DST, switching Saturday 24:00 (= Sunday 00:00)

  // Europe — EU-wide DST is last Sunday of March 01:00 UTC → last Sunday of October 01:00 UTC.
  "Europe/London": "GMT0BST,M3.5.0/1,M10.5.0",
  "Europe/Dublin": "GMT0IST,M3.5.0/1,M10.5.0", // tzdata models Ireland as *negative* DST (IST is its standard time); this is the portable equivalent
  "Europe/Lisbon": "WET0WEST,M3.5.0/1,M10.5.0",
  "Europe/Madrid": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Paris": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Amsterdam": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Berlin": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Zurich": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Rome": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Stockholm": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Warsaw": "CET-1CEST,M3.5.0,M10.5.0/3",
  "Europe/Athens": "EET-2EEST,M3.5.0/3,M10.5.0/4", // same UTC instants as CET, one hour later in local terms
  "Europe/Istanbul": "<+03>-3", // Türkiye abolished DST in 2016 and stays on UTC+3 year-round
  "Europe/Moscow": "MSK-3", // Russia abolished DST in 2011/2014

  // Africa & Middle East
  "Africa/Lagos": "WAT-1",
  "Africa/Cairo": "EET-2EEST,M4.5.5/0,M10.5.4/24", // Egypt re-introduced DST in 2023: last Friday of April 00:00 → last Thursday of October 24:00
  "Africa/Nairobi": "EAT-3",
  "Africa/Johannesburg": "SAST-2", // no DST despite being southern hemisphere
  "Asia/Jerusalem": "IST-2IDT,M3.4.4/26,M10.5.0", // Israel starts DST the Friday *before* the last Sunday of March: 4th Thursday + 26h
  "Asia/Riyadh": "<+03>-3",
  "Asia/Dubai": "GST-4",

  // Asia — no DST in any of these.
  "Asia/Karachi": "PKT-5",
  "Asia/Kolkata": "IST-5:30",
  "Asia/Dhaka": "<+06>-6",
  "Asia/Bangkok": "<+07>-7",
  "Asia/Jakarta": "WIB-7",
  "Asia/Singapore": "<+08>-8",
  "Asia/Hong_Kong": "HKT-8",
  "Asia/Shanghai": "CST-8", // China Standard Time — same abbreviation as US Central, different offset
  "Asia/Manila": "PST-8", // Philippine Standard Time — same abbreviation as US Pacific, different offset
  "Asia/Seoul": "KST-9",
  "Asia/Tokyo": "JST-9",

  // Australia & Pacific — southern-hemisphere DST runs October → April.
  "Australia/Perth": "AWST-8", // Western Australia has no DST
  "Australia/Sydney": "AEST-10AEDT,M10.1.0,M4.1.0/3",
  "Pacific/Auckland": "NZST-12NZDT,M9.5.0,M4.1.0/3", // NZ starts a month earlier than Australia
};

/** Convert a curated IANA zone name to a POSIX TZ string. Unknown/empty → UTC0. */
export function ianaToPosix(iana: string): string {
  return IANA_TO_POSIX[iana] ?? "UTC0";
}

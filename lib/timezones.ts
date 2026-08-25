// Curated IANA timezone list shared by the store add/edit forms and validated
// server-side, so a hand-crafted POST can never store a zone that would make
// `AT TIME ZONE` throw at query time. Keep the list friendly rather than
// exhaustive — full IANA coverage is a non-goal (see the heatmap spec); this is
// a curated set of high-traffic business zones, one per city people search for.

export interface TimezoneOption {
  value: string; // IANA name, e.g. "America/Los_Angeles"
  label: string;
}

// Ordered roughly west→east by region so the picker reads like a globe.
// Every entry MUST have a POSIX TZ mapping in lib/posix-tz.ts (enforced by test).
export const TIMEZONES: TimezoneOption[] = [
  { value: "UTC", label: "UTC" },

  // North America
  { value: "America/New_York", label: "Eastern — New York" },
  { value: "America/Chicago", label: "Central — Chicago" },
  { value: "America/Denver", label: "Mountain — Denver" },
  { value: "America/Phoenix", label: "Arizona — Phoenix" },
  { value: "America/Los_Angeles", label: "Pacific — Los Angeles" },
  { value: "America/Anchorage", label: "Alaska — Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii — Honolulu" },
  { value: "America/Toronto", label: "Toronto" },
  { value: "America/Vancouver", label: "Vancouver" },
  { value: "America/Mexico_City", label: "Mexico City" },

  // Latin America
  { value: "America/Bogota", label: "Bogotá" },
  { value: "America/Lima", label: "Lima" },
  { value: "America/Sao_Paulo", label: "São Paulo" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires" },
  { value: "America/Santiago", label: "Santiago" },

  // Europe
  { value: "Europe/London", label: "London" },
  { value: "Europe/Dublin", label: "Dublin" },
  { value: "Europe/Lisbon", label: "Lisbon" },
  { value: "Europe/Madrid", label: "Madrid" },
  { value: "Europe/Paris", label: "Central Europe — Paris" },
  { value: "Europe/Amsterdam", label: "Amsterdam" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Europe/Zurich", label: "Zurich" },
  { value: "Europe/Rome", label: "Rome" },
  { value: "Europe/Stockholm", label: "Stockholm" },
  { value: "Europe/Warsaw", label: "Warsaw" },
  { value: "Europe/Athens", label: "Athens" },
  { value: "Europe/Istanbul", label: "Istanbul" },
  { value: "Europe/Moscow", label: "Moscow" },

  // Africa & Middle East
  { value: "Africa/Lagos", label: "Lagos" },
  { value: "Africa/Cairo", label: "Cairo" },
  { value: "Africa/Nairobi", label: "Nairobi" },
  { value: "Africa/Johannesburg", label: "Johannesburg" },
  { value: "Asia/Jerusalem", label: "Israel — Jerusalem" },
  { value: "Asia/Riyadh", label: "Riyadh" },
  { value: "Asia/Dubai", label: "Dubai" },

  // Asia
  { value: "Asia/Karachi", label: "Karachi" },
  { value: "Asia/Kolkata", label: "India — Kolkata" },
  { value: "Asia/Dhaka", label: "Dhaka" },
  { value: "Asia/Bangkok", label: "Bangkok" },
  { value: "Asia/Jakarta", label: "Jakarta" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Hong_Kong", label: "Hong Kong" },
  { value: "Asia/Shanghai", label: "Shanghai" },
  { value: "Asia/Manila", label: "Manila" },
  { value: "Asia/Seoul", label: "Seoul" },
  { value: "Asia/Tokyo", label: "Tokyo" },

  // Australia & Pacific
  { value: "Australia/Perth", label: "Perth" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "Pacific/Auckland", label: "Auckland" },
];

const VALID = new Set(TIMEZONES.map((t) => t.value));

export const DEFAULT_TIMEZONE = "UTC";

export function isValidTimezone(tz: string): boolean {
  return VALID.has(tz);
}

/** Returns the zone if listed, otherwise UTC. Safe for untrusted input. */
export function normalizeTimezone(tz: string | null | undefined): string {
  return tz && VALID.has(tz) ? tz : DEFAULT_TIMEZONE;
}

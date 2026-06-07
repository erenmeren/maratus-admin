// Curated IANA timezone list shared by the store add/edit forms and validated
// server-side, so a hand-crafted POST can never store a zone that would make
// `AT TIME ZONE` throw at query time. Keep the list short and friendly — full
// IANA coverage is a non-goal (see the heatmap spec).

export interface TimezoneOption {
  value: string; // IANA name, e.g. "America/Los_Angeles"
  label: string;
}

export const TIMEZONES: TimezoneOption[] = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "Eastern — New York" },
  { value: "America/Chicago", label: "Central — Chicago" },
  { value: "America/Denver", label: "Mountain — Denver" },
  { value: "America/Phoenix", label: "Arizona — Phoenix" },
  { value: "America/Los_Angeles", label: "Pacific — Los Angeles" },
  { value: "America/Anchorage", label: "Alaska — Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii — Honolulu" },
  { value: "America/Toronto", label: "Toronto" },
  { value: "America/Mexico_City", label: "Mexico City" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Central Europe — Paris" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Europe/Madrid", label: "Madrid" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Kolkata", label: "India — Kolkata" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
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

// Pure validation for the pinned-QR feature. Shared by
// PUT /api/v1/devices/{deviceId}/pin and the tenant server action.

export const PIN_URL_MAX_LENGTH = 2048;

export type PinBodyResult = { ok: true; url: string } | { ok: false; error: string };

export function validatePinBody(raw: unknown): PinBodyResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const url = (raw as { url?: unknown }).url;
  if (typeof url !== "string" || url.length === 0) {
    return { ok: false, error: "`url` is required and must be a string." };
  }
  if (url.length > PIN_URL_MAX_LENGTH) {
    return { ok: false, error: `\`url\` must be at most ${PIN_URL_MAX_LENGTH} characters.` };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "`url` must be an absolute URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "`url` must use http or https." };
  }
  return { ok: true, url };
}

/** Pin mode shared by device and store levels. */
export type PinMode = "inherit" | "custom" | "none";

export type PinPutBodyResult =
  | { ok: true; kind: "url"; url: string }
  | { ok: true; kind: "mode"; mode: "none" | "inherit" }
  | { ok: false; error: string };

/**
 * PUT body for the scoped pin endpoints: {url} sets a custom pin (paid),
 * {mode:"none"|"inherit"} switches mode (free). "custom" mode is only ever
 * expressed by sending a url. Org scope has no modes → allowMode: false.
 */
export function validatePinPutBody(
  raw: unknown,
  opts: { allowMode?: boolean } = {},
): PinPutBodyResult {
  const allowMode = opts.allowMode ?? true;
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const { url, mode } = raw as { url?: unknown; mode?: unknown };
  if (url !== undefined && mode !== undefined) {
    return { ok: false, error: "Send either `url` or `mode`, not both." };
  }
  if (mode !== undefined) {
    if (!allowMode) return { ok: false, error: "`mode` is not supported at this scope; send `url`." };
    if (mode !== "none" && mode !== "inherit") {
      return { ok: false, error: "`mode` must be \"none\" or \"inherit\" (custom = send `url`)." };
    }
    return { ok: true, kind: "mode", mode };
  }
  const v = validatePinBody(raw);
  if (!v.ok) return v;
  return { ok: true, kind: "url", url: v.url };
}

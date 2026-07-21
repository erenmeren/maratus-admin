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

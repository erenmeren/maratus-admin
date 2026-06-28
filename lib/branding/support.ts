// lib/branding/support.ts
// Pure: validate + resolve the optional customer-support contact links shown on
// the public document page. Single source of truth for "what to render" and for
// the settings-form validation. No IO.

/** Basic shape check: has an "@" with a dotted domain after it. Not RFC-perfect — just enough to avoid rendering an obviously-broken mailto. */
export function isLikelyEmail(s: string): boolean {
  const at = s.indexOf("@");
  if (at <= 0) return false;
  const domain = s.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

/** Only http(s) absolute URLs are renderable as a safe external link. */
export function isHttpUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s);
}

export interface SupportLinks {
  email: string | null;
  url: string | null;
  show: boolean;
}

export function supportLinks(input: {
  supportEmail: string | null;
  supportUrl: string | null;
}): SupportLinks {
  const e = (input.supportEmail ?? "").trim();
  const u = (input.supportUrl ?? "").trim();
  const email = isLikelyEmail(e) ? e : null;
  const url = isHttpUrl(u) ? u : null;
  return { email, url, show: email != null || url != null };
}

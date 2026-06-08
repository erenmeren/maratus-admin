// Block outbound webhook SSRF: require https + reject private/loopback/link-local
// hosts. Checked at endpoint creation AND before each delivery (DNS can change).
// Pure string/IP-literal checks (no DNS resolution — acceptable for v1).

export type UrlCheck = { ok: true } | { ok: false; reason: string };

export function isAllowedWebhookUrl(raw: string): UrlCheck {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "must_be_https" };

  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost")) {
    return { ok: false, reason: "blocked_host" };
  }

  // IPv6 literal (URL hostname keeps brackets stripped for ::1? Normalize.)
  const ipv6 = host.replace(/^\[/, "").replace(/\]$/, "");
  if (ipv6.includes(":")) {
    if (ipv6 === "::1") return { ok: false, reason: "blocked_ip" };
    if (/^f[cd]/.test(ipv6)) return { ok: false, reason: "blocked_ip" }; // fc00::/7 ULA
    if (/^fe80/.test(ipv6)) return { ok: false, reason: "blocked_ip" }; // link-local
    return { ok: true };
  }

  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return { ok: false, reason: "blocked_ip" };
    if (a === 169 && b === 254) return { ok: false, reason: "blocked_ip" };
    if (a === 172 && b >= 16 && b <= 31) return { ok: false, reason: "blocked_ip" };
    if (a === 192 && b === 168) return { ok: false, reason: "blocked_ip" };
  }

  return { ok: true };
}

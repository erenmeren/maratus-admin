// Block outbound webhook SSRF: require https + reject private/loopback/link-local
// hosts. Checked at endpoint creation AND before each delivery (DNS can change).
//
// Two layers:
//  - `isAllowedWebhookUrl` (sync): scheme + localhost + literal-IP checks. Used at
//    endpoint-create time on form input, and as the fast-reject in the async guard.
//  - `assertAllowedWebhookUrl` (async): additionally resolves the hostname via DNS
//    and blocks if ANY resolved address is private/loopback/link-local. Used before
//    delivery so a public hostname that RESOLVES to an internal IP can't be reached.
import dns from "node:dns";

export type UrlCheck = { ok: true } | { ok: false; reason: string };

/**
 * Pure IP classifier: true for loopback/private/link-local/ULA/unspecified, for
 * both IPv4 and IPv6. No IO, no imports from lib/db — safe to unit-test directly.
 * Accepts a bare IP string (IPv6 may be passed with or without brackets).
 */
export function isBlockedIp(ip: string): boolean {
  const addr = ip.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  if (addr.includes(":")) {
    // IPv6
    if (addr === "::1") return true; // loopback
    if (addr === "::") return true; // unspecified
    if (/^f[cd]/.test(addr)) return true; // fc00::/7 ULA
    if (/^fe80/.test(addr)) return true; // fe80::/10 link-local
    return false;
  }

  const m = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return true; // unspecified, loopback, 10/8
    if (a === 169 && b === 254) return true; // 169.254/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
    if (a === 192 && b === 168) return true; // 192.168/16 private
    return false;
  }

  return false;
}

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

  // Literal IP in the host (IPv6 keeps brackets in URL.hostname — isBlockedIp strips).
  if (isBlockedIp(host)) return { ok: false, reason: "blocked_ip" };

  return { ok: true };
}

/**
 * Delivery-time guard. Runs the sync checks first (scheme/localhost/literal IP),
 * then resolves the hostname and blocks if ANY resolved address is private/
 * loopback/link-local. Fails CLOSED on DNS error — we never POST to a host we
 * can't safely resolve.
 *
 * Residual TOCTOU: full DNS-rebinding protection requires pinning the resolved IP
 * onto the socket used by fetch (resolve-then-connect to the same address). This is
 * a best-effort mitigation for v1 — between this lookup and fetch's own lookup the
 * record could change.
 */
export async function assertAllowedWebhookUrl(raw: string): Promise<UrlCheck> {
  const sync = isAllowedWebhookUrl(raw);
  if (!sync.ok) return sync;

  // raw is a valid https URL at this point (sync passed).
  const host = new URL(raw).hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  let resolved: { address: string }[];
  try {
    resolved = await dns.promises.lookup(host, { all: true });
  } catch {
    return { ok: false, reason: "dns_error" };
  }

  for (const { address } of resolved) {
    if (isBlockedIp(address)) return { ok: false, reason: "blocked_resolved_ip" };
  }

  return { ok: true };
}

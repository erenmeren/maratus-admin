// Origins Better Auth accepts browser requests from.
//
// Better Auth validates the Origin header on any request that carries cookies
// or Sec-Fetch metadata — i.e. every real browser request, while bare curl
// skips the check. So EVERY custom domain aliased to the prod deployment must
// be listed here; a missing one fails browser logins from that host with
// INVALID_ORIGIN. BETTER_AUTH_URL only covers one of them.
export function computeTrustedOrigins(
  baseURL: string,
  production: boolean,
): string[] {
  return [
    // Vercel's own domains: the production alias + per-deploy preview URLs.
    "https://*.vercel.app",
    baseURL,
    // Custom-domain aliases of the prod deployment (Cloudflare DNS → Vercel).
    "https://api.maratus.co",
    "https://console.maratus.co",
    "https://api.maratus.dev",
    // `next dev` falls back to another port when 3000 is taken, which would
    // otherwise be rejected.
    ...(production ? [] : ["http://localhost:*"]),
  ];
}

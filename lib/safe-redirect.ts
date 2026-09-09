// Post-login `?redirect=` is attacker-suppliable in a crafted link; Next's
// router.push treats an absolute URL as a hard navigation, so only a plain
// same-origin path may pass through.
export function safeRedirectPath(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  return /^\/(?![/\\])/.test(raw) ? raw : fallback;
}

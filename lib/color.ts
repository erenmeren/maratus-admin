// Small color helpers for the Branding live preview.
// A tenant's brand color is DATA — these helpers render it safely on the
// kiosk mockup without leaking into the app chrome.

/** Parse #rgb / #rrggbb into [r,g,b] (0–255). Falls back to emerald. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return [16, 122, 87];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Relative luminance (0–1) via the sRGB formula. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pick a readable foreground (near-black or near-white) for a background. */
export function readableOn(hex: string): string {
  return luminance(hex) > 0.5 ? "#0b1220" : "#ffffff";
}

/** rgba() string from a hex + alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Validate a user-typed hex color. */
export function isValidHex(hex: string): boolean {
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
}

/**
 * Kiosk theme tokens. `accent` is the tenant's brand color; bg/fg/muted let a
 * tenant tune the kiosk background / text / secondary-text independently. When a
 * tenant hasn't set bg/fg/muted, these neutral defaults apply (a cool near-white
 * surface, near-black text, mid-gray secondary) — they read cleanly under any accent.
 */
export interface BrandTokens {
  accent: string;
  bg: string;
  fg: string;
  muted: string;
}

export const DEFAULT_BRAND_BG = "#f3f4f7";
export const DEFAULT_BRAND_FG = "#191b20";
export const DEFAULT_BRAND_MUTED = "#8b909b";

export function resolveBrandTokens(
  accent: string,
  t?: { bg?: string | null; fg?: string | null; muted?: string | null },
): BrandTokens {
  return {
    accent,
    bg: t?.bg || DEFAULT_BRAND_BG,
    fg: t?.fg || DEFAULT_BRAND_FG,
    muted: t?.muted || DEFAULT_BRAND_MUTED,
  };
}

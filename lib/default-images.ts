import { env } from "@/lib/env";

export type DefaultImageName = "check" | "wifi-off";

/** Absolute URL of a bundled default decorative image (served from public/defaults). */
export function defaultImageUrl(name: DefaultImageName): string {
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  return `${base}/defaults/${name}.png`;
}

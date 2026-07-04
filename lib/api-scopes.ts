export const API_SCOPES = ["usage:read", "devices:trigger"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const DEFAULT_KEY_SCOPES: ApiScope[] = ["usage:read"];

export function hasScope(scopes: readonly string[] | null | undefined, required: ApiScope): boolean {
  return Array.isArray(scopes) && scopes.includes(required);
}

/** Keep only known scopes, de-duplicated, preserving canonical order. */
export function sanitizeScopes(raw: unknown): ApiScope[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set(raw.filter((s): s is string => typeof s === "string"));
  return API_SCOPES.filter((s) => set.has(s));
}

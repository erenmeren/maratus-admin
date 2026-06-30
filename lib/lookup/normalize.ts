// Pure email normalization for the public document-email + recovery forms.
export function normalizeEmail(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  // Deliberately conservative: exactly one @, non-empty local part, dotted domain.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return null;
  return s;
}

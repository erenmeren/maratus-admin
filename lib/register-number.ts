// Register (kasa) number: the customer's own label for the till a device sits
// at. Used in the URL of the trigger-by-register endpoint, so it is restricted
// to URL-safe characters. Unique per org, case-insensitively (see device table).

export const REGISTER_NUMBER_MAX = 40;
const REGISTER_RE = /^[A-Za-z0-9._-]+$/;

export type ParsedRegister =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export function parseRegisterNumber(input: string | null | undefined): ParsedRegister {
  const v = (input ?? "").trim();
  if (!v) return { ok: true, value: null };
  if (v.length > REGISTER_NUMBER_MAX) {
    return { ok: false, error: `Register number can be at most ${REGISTER_NUMBER_MAX} characters.` };
  }
  if (!REGISTER_RE.test(v)) {
    return { ok: false, error: "Register number may only contain letters, digits, '.', '_' and '-'." };
  }
  return { ok: true, value: v };
}

/** Comparison key — mirrors the lower() in the unique index. */
export function registerKey(value: string): string {
  return value.toLowerCase();
}

/** Postgres unique violation, directly or wrapped (drizzle puts it on `cause`). */
export function isUniqueViolation(err: unknown): boolean {
  for (let i = 0; i < 5 && err && typeof err === "object"; i++) {
    if ((err as { code?: unknown }).code === "23505") return true;
    err = (err as { cause?: unknown }).cause;
  }
  return false;
}

/** Constraint name of a Postgres unique violation (direct or on `cause`), else null. */
export function uniqueViolationConstraint(err: unknown): string | null {
  for (let i = 0; i < 5 && err && typeof err === "object"; i++) {
    const node = err as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (node.code === "23505") {
      if (typeof node.constraint === "string" && node.constraint) return node.constraint;
      if (typeof node.message === "string") {
        const m = /unique constraint "([^"]+)"/.exec(node.message);
        if (m) return m[1];
      }
      return null;
    }
    err = node.cause;
  }
  return null;
}

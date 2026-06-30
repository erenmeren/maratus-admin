// Pure (IO-free) magic-link token helpers. `now` is injected for determinism.
import { nanoid } from "nanoid";
import { hashLookupToken } from "@/lib/ids";

export const LOOKUP_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function generateLookupToken(): { raw: string; hash: string } {
  const raw = nanoid(40);
  return { raw, hash: hashLookupToken(raw) };
}

export function isLookupValid(
  row: { expiresAt: Date; consumedAt: Date | null },
  now: Date,
): boolean {
  if (row.consumedAt != null) return false;
  return now.getTime() <= row.expiresAt.getTime();
}

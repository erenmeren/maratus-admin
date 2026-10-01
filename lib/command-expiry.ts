// Terminal state for triggers nobody acked. A trigger carries
// expiresAt = createdAt + 60 s (lib/api/trigger-device.ts)
// because it is a QR for the customer at the counter NOW; once that passes it
// must become `expired`, not sit `pending` forever. The heartbeat
// republish already refuses expired rows; this sweep just records the fact.
import { and, eq, gt, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { deviceCommand } from "./db/schema";

export function isExpiredPending(
  cmd: { status: string; expiresAt: Date | null },
  now: Date,
): boolean {
  return cmd.status === "pending" && cmd.expiresAt !== null && cmd.expiresAt.getTime() < now.getTime();
}

/** Window for the "undelivered trigger" signal: a QR that never reached a
 *  screen is only news while it is recent. */
export const UNDELIVERED_WINDOW_MS = 24 * 60 * 60 * 1000;

/** WHERE for "a trigger that never reached a screen in the window": recent AND
 *  either already recorded `expired` by the daily sweep, or still `pending`
 *  past its 60 s TTL — the same fact before the sweep has run. (The old
 *  "pending for 30+ minutes with an open TTL" predicate was unsatisfiable: a
 *  trigger's TTL closes 60 s after it is created.) */
export function undeliveredTriggerWhere(now: Date, windowMs = UNDELIVERED_WINDOW_MS): SQL {
  const from = new Date(now.getTime() - windowMs);
  return and(
    eq(deviceCommand.type, "trigger"),
    gt(deviceCommand.createdAt, from),
    or(
      eq(deviceCommand.status, "expired"),
      and(
        eq(deviceCommand.status, "pending"),
        isNotNull(deviceCommand.expiresAt),
        lt(deviceCommand.expiresAt, now),
      ),
    ),
  )!;
}

/** Pure mirror of `undeliveredTriggerWhere` (same predicate, in JS). */
export function isUndeliveredTrigger(
  cmd: { type: string; status: string; expiresAt: Date | null; createdAt: Date },
  now: Date,
  windowMs = UNDELIVERED_WINDOW_MS,
): boolean {
  if (cmd.type !== "trigger") return false;
  if (cmd.createdAt.getTime() <= now.getTime() - windowMs) return false;
  if (cmd.status === "expired") return true;
  return isExpiredPending(cmd, now);
}

/** Flip every pending command whose TTL has passed to `expired`. Idempotent;
 *  returns how many rows changed. Called from the daily health sweep. */
export async function expireStaleCommands(now: Date): Promise<number> {
  const rows = await db
    .update(deviceCommand)
    .set({ status: "expired", result: sql`coalesce(${deviceCommand.result}, 'ttl_expired')` })
    .where(
      and(
        eq(deviceCommand.status, "pending"),
        isNotNull(deviceCommand.expiresAt),
        lt(deviceCommand.expiresAt, now),
      ),
    )
    .returning({ id: deviceCommand.id });
  return rows.length;
}

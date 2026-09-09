// Terminal state for triggers nobody acked. A trigger carries
// expiresAt = createdAt + 60 s (app/api/v1/devices/[deviceId]/trigger/route.ts)
// because it is a QR for the customer at the counter NOW; once that passes it
// must become `expired`, not sit `pending` forever inflating every "stuck
// pending" KPI and keeping the documents-stuck alert open. The heartbeat
// republish already refuses expired rows; this sweep just records the fact.
import { and, eq, gt, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { deviceCommand } from "./db/schema";

export function isExpiredPending(
  cmd: { status: string; expiresAt: Date | null },
  now: Date,
): boolean {
  return cmd.status === "pending" && cmd.expiresAt !== null && cmd.expiresAt.getTime() < now.getTime();
}

/** WHERE for "a trigger that is genuinely stuck": pending, older than the
 *  stuck threshold, AND not merely past its TTL (those are `expired` in
 *  waiting — the sweep below records them; until it runs they must not count). */
export function stuckPendingTriggerWhere(now: Date, stuckMinutes: number): SQL {
  const stuckCut = new Date(now.getTime() - stuckMinutes * 60_000);
  return and(
    eq(deviceCommand.type, "trigger"),
    eq(deviceCommand.status, "pending"),
    lt(deviceCommand.createdAt, stuckCut),
    or(isNull(deviceCommand.expiresAt), gt(deviceCommand.expiresAt, now)),
  )!;
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

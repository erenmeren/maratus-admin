// Release credit holds whose trigger command expired without an ack.
// Used by BOTH the daily backstop cron (all orgs) and the trigger endpoint
// (scoped to the calling org) so an org's own activity reconciles its holds
// promptly without depending on a frequent cron — which the Vercel Hobby plan
// does not allow (daily crons only). The deviceCommand status transition is the
// lock: `WHERE status = 'pending' RETURNING` — only the winner of the
// transition releases, so this can never race an ack into a double credit move.
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { deviceCommand } from "@/lib/db/schema";
import { releaseHold } from "@/lib/credits";
import { creditCostForAction } from "@/lib/trigger-actions";

/** Release all expired (unacked) trigger holds, optionally scoped to one org. */
export async function releaseExpiredHolds(opts?: { organizationId?: string }): Promise<{ released: number }> {
  const now = new Date();
  const where = opts?.organizationId
    ? and(
        eq(deviceCommand.type, "trigger"),
        eq(deviceCommand.organizationId, opts.organizationId),
        eq(deviceCommand.status, "pending"),
        lt(deviceCommand.expiresAt, now),
      )
    : and(
        eq(deviceCommand.type, "trigger"),
        eq(deviceCommand.status, "pending"),
        lt(deviceCommand.expiresAt, now),
      );

  const expired = await db
    .select({
      id: deviceCommand.id,
      organizationId: deviceCommand.organizationId,
      action: deviceCommand.action,
      deviceId: deviceCommand.deviceId,
      billing: deviceCommand.billing,
    })
    .from(deviceCommand)
    .where(where);

  let released = 0;
  for (const c of expired) {
    const [won] = await db
      .update(deviceCommand)
      .set({ status: "expired" })
      .where(and(eq(deviceCommand.id, c.id), eq(deviceCommand.status, "pending")))
      .returning({ id: deviceCommand.id });
    if (!won) continue; // lost the race to an ack
    // Included (plan-covered) triggers hold no credits — expiring the command is enough.
    if (c.billing !== "included") {
      await releaseHold({
        organizationId: c.organizationId,
        commandId: c.id,
        cost: creditCostForAction((c.action ?? "show_qr") as "show_qr"),
        deviceId: c.deviceId,
      });
      released++;
    }
  }
  return { released };
}

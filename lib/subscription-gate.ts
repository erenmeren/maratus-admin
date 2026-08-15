// The whole trigger-path billing decision. Post-paid overage means quota
// blocks nothing, so the only question left is whether this device is paid for
// — or still inside its trial.

import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { deviceCommand } from "./db/schema";
import { TRIAL_TRIGGERS_PER_DEVICE } from "./invoicing";

export type GateDecision =
  | { ok: true; reason: "subscribed" | "trial" }
  | { ok: false; reason: "device_not_subscribed" };

export function decideGate(a: {
  subscriptionPaidAt: Date | null;
  trialTriggersUsed: number;
}): GateDecision {
  if (a.subscriptionPaidAt) return { ok: true, reason: "subscribed" };
  return a.trialTriggersUsed < TRIAL_TRIGGERS_PER_DEVICE
    ? { ok: true, reason: "trial" }
    : { ok: false, reason: "device_not_subscribed" };
}

/**
 * A paid device costs ZERO extra queries — the trial count runs only on the
 * unpaid branch. The lifetime count needs no reset on payment because the
 * branch is skipped once subscriptionPaidAt is set.
 * Covered by device_command_device_status_idx.
 */
export async function checkSubscriptionGate(a: {
  deviceId: string;
  subscriptionPaidAt: Date | null;
}): Promise<GateDecision> {
  if (a.subscriptionPaidAt) return { ok: true, reason: "subscribed" };
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(deviceCommand)
    .where(
      and(
        eq(deviceCommand.deviceId, a.deviceId),
        eq(deviceCommand.type, "trigger"),
        eq(deviceCommand.status, "acked"),
      ),
    );
  return decideGate({
    subscriptionPaidAt: null,
    trialTriggersUsed: Number(row?.c ?? 0),
  });
}

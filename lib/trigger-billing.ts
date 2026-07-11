// Orchestrates how a trigger is paid: org plan lookup → usage bump → decision
// → credit hold only on the credits path. Bump-then-decide keeps the quota
// check O(1) and race-safe; every rejection path compensates the bump so a
// failed call never burns quota.

import { eq } from "drizzle-orm";
import { db } from "./db";
import { tenantSettings } from "./db/schema";
import {
  DEFAULT_INCLUDED_TRIGGERS,
  monthKey,
  triggerBillingDecision,
  type BillingPlan,
} from "./billing-plan";
import { bumpDeviceUsage, unbumpDeviceUsage } from "./device-usage";
import { releaseHold, reserveCredit } from "./credits";

export type TriggerReservation =
  | { ok: true; billing: "credits" | "included"; month: string }
  | { ok: false; reason: "insufficient_credits" | "fair_use_exceeded" };

export async function reserveTrigger(a: {
  organizationId: string;
  deviceId: string;
  action: string;
  commandId: string;
  cost: number;
}): Promise<TriggerReservation> {
  const [settings] = await db
    .select({
      plan: tenantSettings.billingPlan,
      included: tenantSettings.includedTriggersPerDevice,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.organizationId, a.organizationId))
    .limit(1);
  const plan: BillingPlan = settings?.plan ?? "credits";
  const month = monthKey(new Date());

  const used = await bumpDeviceUsage({
    deviceId: a.deviceId,
    organizationId: a.organizationId,
    month,
  });
  const decision = triggerBillingDecision({
    plan,
    includedTriggersPerDevice: settings?.included ?? DEFAULT_INCLUDED_TRIGGERS,
    usedThisMonth: used,
  });

  if (decision.mode === "fair_use_exceeded") {
    await unbumpDeviceUsage({ deviceId: a.deviceId, month });
    return { ok: false, reason: "fair_use_exceeded" };
  }
  if (decision.mode === "included") return { ok: true, billing: "included", month };

  const reserved = await reserveCredit(a);
  if (!reserved.ok) {
    await unbumpDeviceUsage({ deviceId: a.deviceId, month });
    return { ok: false, reason: "insufficient_credits" };
  }
  return { ok: true, billing: "credits", month };
}

/** Undo a successful reserveTrigger (e.g. the command enqueue failed). */
export async function cancelTriggerReservation(a: {
  organizationId: string;
  deviceId: string;
  commandId: string;
  cost: number;
  billing: "credits" | "included";
  month: string;
}): Promise<void> {
  if (a.billing === "credits") {
    await releaseHold({
      organizationId: a.organizationId,
      commandId: a.commandId,
      cost: a.cost,
      deviceId: a.deviceId,
    });
  }
  await unbumpDeviceUsage({ deviceId: a.deviceId, month: a.month });
}

// lib/trigger-ack.ts
// Single home for the "did this trigger ack move credits?" decision and the
// settle/release side effect. Shared by the HTTP ack route and the MQTT ack
// webhook so the money rule exists in exactly one place.

import { settleHold, releaseHold } from "@/lib/credits";
import { creditCostForAction } from "@/lib/trigger-actions";

export type AckedCommand = {
  id: string;
  type: string | null;
  action: string | null;
  organizationId: string;
  deviceId: string;
  billing: string | null;
};

/** A credit-billed trigger moves credits on ack; "included" and non-triggers do not.
 *  Null billing = legacy credit-held row → treated as "credits". */
export function shouldMoveCredits(cmd: { type: string | null; billing: string | null }): boolean {
  return cmd.type === "trigger" && cmd.billing !== "included";
}

/** Settle (success) or release (failure) the credit hold for an acked trigger. */
export async function applyTriggerAck(cmd: AckedCommand, ok: boolean): Promise<void> {
  if (!shouldMoveCredits(cmd)) return;
  const cost = creditCostForAction((cmd.action ?? "show_qr") as "show_qr");
  if (ok) {
    await settleHold({ organizationId: cmd.organizationId, commandId: cmd.id, cost, deviceId: cmd.deviceId });
  } else {
    await releaseHold({ organizationId: cmd.organizationId, commandId: cmd.id, cost, deviceId: cmd.deviceId });
  }
}

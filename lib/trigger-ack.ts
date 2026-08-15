// lib/trigger-ack.ts
// Historically the single home for the "did this trigger ack move credits?"
// decision and the settle/release side effect, shared by the ack path so the
// money rule existed in exactly one place. A trigger's cost is now derived at
// period close by counting acked device_command rows directly, so there is
// nothing left to settle here: the command row already reached its terminal
// status (acked/failed) and got ackedAt stamped by the caller before this
// runs. Kept as a no-op call site for app/api/mqtt/ack/route.ts.

export type AckedCommand = {
  id: string;
  type: string | null;
  action: string | null;
  organizationId: string;
  deviceId: string;
};

/** No-op: there is no credit hold to settle or release on ack any more. */
export async function applyTriggerAck(_cmd: AckedCommand, _ok: boolean): Promise<void> {
  return;
}

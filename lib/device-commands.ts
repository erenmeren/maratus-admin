// lib/device-commands.ts
// Pure: device command types + validation.
//
// This list is deliberately NARROWER than deviceCommand.type in lib/db/schema.ts
// (which has 7 values, including "pin"). It is the allowlist for commands a user
// may manually enqueue via enqueueDeviceCommand (lib/actions/device-commands.ts),
// which is its one production caller — not "all valid command types" that the DB
// may legitimately store.
//
// Excluded on purpose:
// - "trigger": overage billing counts acked "trigger"-typed deviceCommand rows
//   directly (lib/invoices.ts countAckedTriggers), with no per-row cost field
//   to distinguish real from manual. A manually-enqueued trigger would inflate
//   that count without going through the real trigger route's ownership/
//   subscription-gate checks (app/api/v1/devices/[deviceId]/trigger/route.ts),
//   and the firmware acks ok=false for a triggerless/empty payload anyway.
//   Triggers may only ever originate from the v1 trigger route.
// - "config-changed": redundant with "refresh" — the firmware maps refresh onto
//   the same handler that re-requests config, and branding/device-settings
//   changes already push config themselves. A manual config-changed just
//   publishes a null payload the device answers with another cfg/get round trip.
export const MANUAL_COMMAND_TYPES = ["reboot", "refresh", "identify", "firmware-update"] as const;
export type ManualCommandType = (typeof MANUAL_COMMAND_TYPES)[number];

export function isManualCommandType(t: string): t is ManualCommandType {
  return (MANUAL_COMMAND_TYPES as readonly string[]).includes(t);
}

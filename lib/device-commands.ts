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
// - "trigger": a manually-enqueued trigger command inserts a deviceCommand row
//   with no credit reservation (reservation only happens in the real trigger
//   route, app/api/v1/devices/[deviceId]/trigger/route.ts). The firmware acks
//   ok=false for a triggerless/empty payload, and applyTriggerAck's
//   shouldMoveCredits (lib/trigger-ack.ts) treats a "trigger"-typed row as
//   billable even with null billing (legacy-row default). That drives
//   releaseHold, which is keyed on the org's scalar creditBalance.held counter
//   rather than a specific hold — so it can release the hold of an unrelated,
//   genuinely in-flight trigger for that org, leaving it unbilled. Triggers may
//   only ever originate from the v1 trigger route.
// - "config-changed": redundant with "refresh" — the firmware maps refresh onto
//   the same handler that re-requests config, and branding/device-settings
//   changes already push config themselves. A manual config-changed just
//   publishes a null payload the device answers with another cfg/get round trip.
export const MANUAL_COMMAND_TYPES = ["reboot", "refresh", "identify", "firmware-update"] as const;
export type ManualCommandType = (typeof MANUAL_COMMAND_TYPES)[number];

export function isManualCommandType(t: string): t is ManualCommandType {
  return (MANUAL_COMMAND_TYPES as readonly string[]).includes(t);
}

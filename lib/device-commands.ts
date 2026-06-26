// lib/device-commands.ts
// Pure: device command types + validation.

export const COMMAND_TYPES = ["reboot", "refresh", "identify", "config-changed", "firmware-update", "trigger"] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export function isValidCommandType(t: string): t is CommandType {
  return (COMMAND_TYPES as readonly string[]).includes(t);
}

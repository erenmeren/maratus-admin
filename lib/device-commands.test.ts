import { describe, it, expect } from "vitest";
import { isManualCommandType, MANUAL_COMMAND_TYPES } from "./device-commands";

describe("isManualCommandType", () => {
  it("accepts the known manual types", () => {
    for (const t of MANUAL_COMMAND_TYPES) expect(isManualCommandType(t)).toBe(true);
  });
  it("rejects unknown", () => {
    expect(isManualCommandType("shutdown")).toBe(false);
    expect(isManualCommandType("")).toBe(false);
  });
  it("accepts firmware-update (M6b)", () => {
    expect(isManualCommandType("firmware-update")).toBe(true);
  });
  it("rejects trigger — a manual trigger command takes no credit reservation, and its ack can release an unrelated in-flight hold via the org's scalar creditBalance.held counter (see lib/trigger-ack.ts shouldMoveCredits + lib/credits.ts releaseHold); triggers may only originate from the v1 trigger route", () => {
    expect(isManualCommandType("trigger")).toBe(false);
  });
  it("rejects config-changed — redundant with refresh, which the firmware already maps onto the same config re-request handler", () => {
    expect(isManualCommandType("config-changed")).toBe(false);
  });
});

// lib/trigger-ack.test.ts
import { describe, it, expect } from "vitest";
import { applyTriggerAck } from "./trigger-ack";

describe("applyTriggerAck", () => {
  it("resolves without error for an acked trigger — cost is derived from acked rows at period close, not settled here", async () => {
    await expect(
      applyTriggerAck(
        { id: "cmd_1", type: "trigger", action: "show_qr", organizationId: "org_1", deviceId: "device_1" },
        true,
      ),
    ).resolves.toBeUndefined();
  });

  it("resolves without error for a failed trigger too", async () => {
    await expect(
      applyTriggerAck(
        { id: "cmd_2", type: "trigger", action: "show_qr", organizationId: "org_1", deviceId: "device_1" },
        false,
      ),
    ).resolves.toBeUndefined();
  });
});

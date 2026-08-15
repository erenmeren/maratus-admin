import { describe, expect, it } from "vitest";
import { decideGate } from "./subscription-gate";

const paid = new Date("2026-08-15T00:00:00Z");

describe("decideGate", () => {
  it("lets a paid device through regardless of usage", () => {
    expect(decideGate({ subscriptionPaidAt: paid, trialTriggersUsed: 999_999 })).toEqual({
      ok: true,
      reason: "subscribed",
    });
  });

  it("lets an unpaid device through inside the trial", () => {
    expect(decideGate({ subscriptionPaidAt: null, trialTriggersUsed: 0 })).toEqual({
      ok: true,
      reason: "trial",
    });
    expect(decideGate({ subscriptionPaidAt: null, trialTriggersUsed: 49 })).toEqual({
      ok: true,
      reason: "trial",
    });
  });

  it("rejects an unpaid device at the trial ceiling", () => {
    expect(decideGate({ subscriptionPaidAt: null, trialTriggersUsed: 50 })).toEqual({
      ok: false,
      reason: "device_not_subscribed",
    });
  });
});

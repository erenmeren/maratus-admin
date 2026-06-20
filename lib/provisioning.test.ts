import { describe, it, expect } from "vitest";
import { classifyClaimPoll } from "./provisioning";

describe("classifyClaimPoll", () => {
  it("returns pending when no device row matches the code", () => {
    expect(classifyClaimPoll(null)).toEqual({ status: "pending", consume: false });
  });

  it("delivers the key and consumes when a claim is pending fetch", () => {
    expect(classifyClaimPoll({ pendingDeviceKey: "dvk_abc" })).toEqual({
      status: "claimed",
      deviceKey: "dvk_abc",
      consume: true,
    });
  });

  it("returns claimed without a key once already delivered", () => {
    expect(classifyClaimPoll({ pendingDeviceKey: null })).toEqual({
      status: "claimed",
      consume: false,
    });
  });
});

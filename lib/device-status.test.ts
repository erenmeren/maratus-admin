import { describe, it, expect } from "vitest";
import { effectiveDeviceStatus, OFFLINE_MINUTES } from "./device-status";

const now = new Date("2026-06-03T12:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("effectiveDeviceStatus", () => {
  it("paused always wins", () => {
    expect(effectiveDeviceStatus("paused", minsAgo(0), now)).toBe("paused");
    expect(effectiveDeviceStatus("paused", null, now)).toBe("paused");
  });
  it("null lastSeen → offline", () => {
    expect(effectiveDeviceStatus("online", null, now)).toBe("offline");
  });
  it("online when seen within threshold, offline when older", () => {
    expect(effectiveDeviceStatus("online", minsAgo(OFFLINE_MINUTES - 1), now)).toBe("online");
    expect(effectiveDeviceStatus("online", minsAgo(OFFLINE_MINUTES + 1), now)).toBe("offline");
  });
  it("online exactly at threshold (strictly greater is offline)", () => {
    expect(effectiveDeviceStatus("online", minsAgo(OFFLINE_MINUTES), now)).toBe("online");
  });
});

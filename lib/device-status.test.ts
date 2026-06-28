import { describe, it, expect } from "vitest";
import {
  effectiveDeviceStatus,
  shouldMarkOffline,
  firmwareUpdateAvailable,
  OFFLINE_MINUTES,
} from "./device-status";

const now = new Date("2026-06-28T12:00:00Z");
const stale = new Date(now.getTime() - (OFFLINE_MINUTES + 1) * 60_000);
const fresh = new Date(now.getTime() - 60_000);
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

describe("shouldMarkOffline", () => {
  it("flips an online device that is stale", () => {
    expect(shouldMarkOffline({ status: "online", lastSeenAt: stale }, now)).toBe(true);
  });
  it("does NOT flip a fresh online device", () => {
    expect(shouldMarkOffline({ status: "online", lastSeenAt: fresh }, now)).toBe(false);
  });
  it("does NOT flip a paused device even if stale", () => {
    expect(shouldMarkOffline({ status: "paused", lastSeenAt: stale }, now)).toBe(false);
  });
  it("does NOT flip an already-offline device", () => {
    expect(shouldMarkOffline({ status: "offline", lastSeenAt: stale }, now)).toBe(false);
  });
  it("flips an online device that was never seen (null lastSeenAt)", () => {
    expect(shouldMarkOffline({ status: "online", lastSeenAt: null }, now)).toBe(true);
  });
});

describe("firmwareUpdateAvailable", () => {
  it("true when latest differs from device version", () => {
    expect(firmwareUpdateAvailable("2.4.1", "2.5.0")).toBe(true);
  });
  it("false when equal", () => {
    expect(firmwareUpdateAvailable("2.5.0", "2.5.0")).toBe(false);
  });
  it("false when there is no latest release", () => {
    expect(firmwareUpdateAvailable("2.4.1", null)).toBe(false);
  });
});

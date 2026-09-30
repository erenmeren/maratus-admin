import { describe, it, expect } from "vitest";
import {
  effectiveDeviceStatus,
  shouldMarkOffline,
  shouldNotifyOffline,
  firmwareUpdateAvailable,
  OFFLINE_MINUTES,
  OFFLINE_NOTIFY_WINDOW_DAYS,
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
  it("a stored offline wins even when lastSeen is recent (presence disconnect)", () => {
    // EMQX's disconnect webhook writes status=offline instantly; the device's
    // last heartbeat can still be minutes fresh. Trusting lastSeen alone let a
    // trigger through to a disconnected device (lost QR, misleading 202).
    expect(effectiveDeviceStatus("offline", minsAgo(1), now)).toBe("offline");
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

describe("shouldNotifyOffline", () => {
  const NOW = new Date("2026-09-09T10:00:00Z");
  const stale = new Date("2026-09-09T09:00:00Z");
  const fresh = new Date("2026-09-09T09:55:00Z");
  it("notifies a stale device (online or offline stored) that was never notified", () => {
    expect(shouldNotifyOffline({ status: "online", lastSeenAt: stale }, null, NOW)).toBe(true);
    expect(shouldNotifyOffline({ status: "offline", lastSeenAt: stale }, null, NOW)).toBe(true);
  });
  it("does not notify twice for the same episode", () => {
    expect(shouldNotifyOffline({ status: "offline", lastSeenAt: stale }, new Date("2026-09-09T09:30:00Z"), NOW)).toBe(false);
  });
  it("notifies again after a reconnect started a new episode", () => {
    expect(shouldNotifyOffline({ status: "offline", lastSeenAt: stale }, new Date("2026-09-09T08:00:00Z"), NOW)).toBe(true);
  });
  it("does not notify a device dark longer than the window", () => {
    const longDark = new Date(NOW.getTime() - (OFFLINE_NOTIFY_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(shouldNotifyOffline({ status: "offline", lastSeenAt: longDark }, null, NOW)).toBe(false);
    // Just inside the window it is still news.
    const justInside = new Date(NOW.getTime() - (OFFLINE_NOTIFY_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);
    expect(shouldNotifyOffline({ status: "offline", lastSeenAt: justInside }, null, NOW)).toBe(true);
  });
  it("never notifies paused, fresh, or never-seen devices", () => {
    expect(shouldNotifyOffline({ status: "paused", lastSeenAt: stale }, null, NOW)).toBe(false);
    expect(shouldNotifyOffline({ status: "online", lastSeenAt: fresh }, null, NOW)).toBe(false);
    expect(shouldNotifyOffline({ status: "offline", lastSeenAt: null }, null, NOW)).toBe(false);
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

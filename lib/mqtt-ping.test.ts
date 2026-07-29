import { describe, it, expect } from "vitest";
import { MQTT_CHANNELS, channelHealth } from "./mqtt-ping";

describe("MQTT_CHANNELS", () => {
  it("covers every upstream webhook channel", () => {
    expect([...MQTT_CHANNELS]).toEqual(["ack", "heartbeat", "presence", "config-request"]);
  });
});

describe("channelHealth", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  it("reports never for a channel that has never been heard", () => {
    expect(channelHealth(null, now)).toBe("never");
  });

  it("reports ok inside the stale window", () => {
    expect(channelHealth(new Date("2026-07-29T11:50:00Z"), now)).toBe("ok");
  });

  it("reports stale past the window", () => {
    expect(channelHealth(new Date("2026-07-29T11:00:00Z"), now)).toBe("stale");
  });

  it("treats the boundary as ok, not stale", () => {
    // 20 min default: exactly 20 min old is still ok, one ms older is stale.
    expect(channelHealth(new Date("2026-07-29T11:40:00Z"), now)).toBe("ok");
    expect(channelHealth(new Date("2026-07-29T11:39:59.999Z"), now)).toBe("stale");
  });

  it("honours a custom window", () => {
    expect(channelHealth(new Date("2026-07-29T11:55:00Z"), now, 2)).toBe("stale");
  });
});

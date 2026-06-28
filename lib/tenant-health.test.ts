import { describe, it, expect } from "vitest";
import { tenantHealthLevel, type TenantHealthInput } from "./tenant-health";
import { INACTIVE_DAYS } from "./health";

const now = new Date("2026-06-28T12:00:00Z");
const base: TenantHealthInput = {
  deviceCount: 3,
  onlineCount: 3,
  offlineCount: 0,
  subscriptionStatus: "active",
};

describe("tenantHealthLevel", () => {
  it("healthy when all online and subscription active", () => {
    expect(tenantHealthLevel(base, now)).toBe("healthy");
  });
  it("critical when subscription is suspended (canceled)", () => {
    expect(tenantHealthLevel({ ...base, subscriptionStatus: "canceled" }, now)).toBe("critical");
  });
  it("critical when devices are offline and none online", () => {
    expect(tenantHealthLevel({ ...base, onlineCount: 0, offlineCount: 3 }, now)).toBe("critical");
  });
  it("NOT critical when the whole fleet is intentionally paused (none offline)", () => {
    // 3 devices, all paused → online 0, offline 0. Paused is intentional, not a failure.
    expect(tenantHealthLevel({ ...base, onlineCount: 0, offlineCount: 0 }, now)).toBe("healthy");
  });
  it("warning when some (but not all) devices are offline", () => {
    expect(tenantHealthLevel({ ...base, onlineCount: 2, offlineCount: 1 }, now)).toBe("warning");
  });
  it("warning on stuck-pending documents", () => {
    expect(tenantHealthLevel({ ...base, stuckPendingCount: 2 }, now)).toBe("warning");
  });
  it("warning when subscription is past_due", () => {
    expect(tenantHealthLevel({ ...base, subscriptionStatus: "past_due" }, now)).toBe("warning");
  });
  it("warning when inactive beyond INACTIVE_DAYS", () => {
    const old = new Date(now.getTime() - (INACTIVE_DAYS + 1) * 86_400_000);
    expect(tenantHealthLevel({ ...base, lastActivityAt: old }, now)).toBe("warning");
  });
  it("critical takes precedence over warning", () => {
    expect(
      tenantHealthLevel({ ...base, subscriptionStatus: "canceled", offlineCount: 1, onlineCount: 2 }, now),
    ).toBe("critical");
  });
  it("an empty fleet (0 devices) is not critical for the zero-online reason", () => {
    expect(tenantHealthLevel({ ...base, deviceCount: 0, onlineCount: 0, offlineCount: 0 }, now)).toBe("healthy");
  });
});

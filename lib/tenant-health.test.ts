import { describe, it, expect } from "vitest";
import { tenantHealthLevel, type TenantHealthInput } from "./tenant-health";
import { INACTIVE_DAYS } from "./health";

const now = new Date("2026-06-28T12:00:00Z");
const base: TenantHealthInput = {
  deviceCount: 3,
  onlineCount: 3,
  offlineCount: 0,
};

describe("tenantHealthLevel", () => {
  it("healthy when all devices online", () => {
    expect(tenantHealthLevel(base, now)).toBe("healthy");
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
  it("warning on stuck-pending triggers", () => {
    expect(tenantHealthLevel({ ...base, stuckPendingCount: 2 }, now)).toBe("warning");
  });
  it("warning when inactive beyond INACTIVE_DAYS", () => {
    const old = new Date(now.getTime() - (INACTIVE_DAYS + 1) * 86_400_000);
    expect(tenantHealthLevel({ ...base, lastActivityAt: old }, now)).toBe("warning");
  });
  it("an empty fleet (0 devices) is not critical for the zero-online reason", () => {
    expect(tenantHealthLevel({ ...base, deviceCount: 0, onlineCount: 0, offlineCount: 0 }, now)).toBe("healthy");
  });
});

describe("tenantHealthLevel — unified list/detail inputs", () => {
  const now2 = new Date("2026-08-04T12:00:00Z");

  it("warns on stuck pending even with the whole fleet online", () => {
    expect(
      tenantHealthLevel(
        { deviceCount: 3, onlineCount: 3, offlineCount: 0, stuckPendingCount: 1, lastActivityAt: now2 },
        now2,
      ),
    ).toBe("warning");
  });

  it("warns after INACTIVE_DAYS of no activity", () => {
    const stale = new Date(now2.getTime() - (INACTIVE_DAYS + 1) * 86_400_000);
    expect(
      tenantHealthLevel(
        { deviceCount: 1, onlineCount: 1, offlineCount: 0, stuckPendingCount: 0, lastActivityAt: stale },
        now2,
      ),
    ).toBe("warning");
  });

  it("stays healthy for a never-active org with everything online", () => {
    expect(
      tenantHealthLevel(
        { deviceCount: 1, onlineCount: 1, offlineCount: 0, stuckPendingCount: 0, lastActivityAt: null },
        now2,
      ),
    ).toBe("healthy");
  });
});

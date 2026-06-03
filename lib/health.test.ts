import { describe, it, expect } from "vitest";
import { isStale, computeAlerts, STALE_MINUTES } from "./health";

const now = new Date("2026-06-03T12:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("isStale", () => {
  it("false for never-seen (null) and paused devices", () => {
    expect(isStale(null, "online", now)).toBe(false);
    expect(isStale(minsAgo(60), "paused", now)).toBe(false);
  });
  it("false when seen within the threshold, true when older", () => {
    expect(isStale(minsAgo(STALE_MINUTES - 1), "online", now)).toBe(false);
    expect(isStale(minsAgo(STALE_MINUTES + 1), "online", now)).toBe(true);
  });
  it("false exactly at the threshold (strictly greater)", () => {
    expect(isStale(minsAgo(STALE_MINUTES), "online", now)).toBe(false);
  });
});

describe("computeAlerts", () => {
  it("no alerts when everything is clear", () => {
    expect(computeAlerts({ staleCount: 0, stuckPendingCount: 0, inactiveTenants: [] })).toEqual([]);
  });
  it("warns on stale devices and stuck receipts", () => {
    const a = computeAlerts({ staleCount: 3, stuckPendingCount: 2, inactiveTenants: [] });
    expect(a.map((x) => x.key)).toEqual(["devices-stale", "receipts-stuck"]);
    expect(a.every((x) => x.severity === "warning")).toBe(true);
  });
  it("emits one info per inactive tenant", () => {
    const a = computeAlerts({ staleCount: 0, stuckPendingCount: 0, inactiveTenants: [{ id: "o1", name: "Acme" }] });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ key: "tenant-inactive:o1", severity: "info" });
  });
});

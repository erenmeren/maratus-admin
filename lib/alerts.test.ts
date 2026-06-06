import { describe, it, expect } from "vitest";
import { diffAlerts, alertEmail } from "./alerts";
import type { HealthAlert } from "./health";

const a = (key: string, message = "m", severity: "info" | "warning" = "warning"): HealthAlert => ({
  key,
  severity,
  message,
});

describe("diffAlerts", () => {
  it("opens newly tripped keys", () => {
    const d = diffAlerts([a("x")], []);
    expect(d.toOpen.map((t) => t.key)).toEqual(["x"]);
    expect(d.toResolve).toEqual([]);
    expect(d.stillOpen).toEqual([]);
  });
  it("resolves keys no longer present", () => {
    const d = diffAlerts([], [{ key: "x", message: "old" }]);
    expect(d.toResolve.map((t) => t.key)).toEqual(["x"]);
    expect(d.toOpen).toEqual([]);
  });
  it("keeps persistent keys with the refreshed message", () => {
    const d = diffAlerts([a("x", "5 stale")], [{ key: "x", message: "3 stale" }]);
    expect(d.toOpen).toEqual([]);
    expect(d.toResolve).toEqual([]);
    expect(d.stillOpen).toEqual([{ key: "x", message: "5 stale" }]);
  });
  it("handles a mix of open/resolve/persist", () => {
    const d = diffAlerts(
      [a("x"), a("y")],
      [{ key: "y", message: "m" }, { key: "z", message: "m" }],
    );
    expect(d.toOpen.map((t) => t.key)).toEqual(["x"]);
    expect(d.toResolve.map((t) => t.key)).toEqual(["z"]);
    expect(d.stillOpen.map((t) => t.key)).toEqual(["y"]);
  });
  it("is all-empty when both inputs are empty", () => {
    expect(diffAlerts([], [])).toEqual({ toOpen: [], toResolve: [], stillOpen: [] });
  });
});

describe("alertEmail", () => {
  it("returns null when there are no new alerts", () => {
    expect(alertEmail([])).toBeNull();
  });
  it("builds a subject + html listing the new alerts", () => {
    const mail = alertEmail([a("x", "2 devices stale")]);
    expect(mail?.subject).toContain("1 new health alert");
    expect(mail?.html).toContain("2 devices stale");
  });
});

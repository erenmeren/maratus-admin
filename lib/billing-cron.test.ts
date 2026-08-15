import { describe, expect, it } from "vitest";
import {
  buildBillingAlerts,
  MAX_PERIOD_LOOKBACK,
  periodsToClose,
} from "./billing-cron";
import { isBillingAlertKey } from "./alerts";

// Anchor used by most cases: 12 March 2026, 10:00 UTC.
const ANCHOR = new Date("2026-03-12T10:00:00Z");

describe("periodsToClose", () => {
  it("closes exactly one period on an ordinary daily run", () => {
    // Second period is in progress; only period 0 has closed.
    expect(periodsToClose(ANCHOR, new Date("2026-04-15T09:00:00Z"))).toEqual([0]);
  });

  it("closes nothing inside the first period", () => {
    expect(periodsToClose(ANCHOR, new Date("2026-03-20T09:00:00Z"))).toEqual([]);
  });

  it("closes nothing at the anchor instant itself", () => {
    expect(periodsToClose(ANCHOR, ANCHOR)).toEqual([]);
  });

  it("closes nothing one millisecond before the first anniversary", () => {
    const justBefore = new Date(Date.UTC(2026, 3, 12, 9, 59, 59, 999));
    expect(periodsToClose(ANCHOR, justBefore)).toEqual([]);
  });

  it("catches up every period missed while the cron was down", () => {
    // Five anniversaries have passed (Apr, May, Jun, Jul, Aug); periods 0..4
    // are all closed and all still owe an invoice.
    expect(periodsToClose(ANCHOR, new Date("2026-08-20T09:00:00Z"))).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it("catches up after an anchor is backdated by the operator", () => {
    // The cutover runbook tells the operator to correct subscriptionStartedAt
    // from the admin panel; a backdated anchor manufactures a whole backlog.
    const backdated = new Date("2025-11-01T00:00:00Z");
    const closed = periodsToClose(backdated, new Date("2026-05-05T09:00:00Z"));
    expect(closed).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("bounds the backlog at the lookback and keeps the newest periods", () => {
    const old = new Date("2020-01-15T00:00:00Z");
    const closed = periodsToClose(old, new Date("2026-01-20T00:00:00Z"));
    expect(closed).toHaveLength(MAX_PERIOD_LOOKBACK);
    // 72 anniversaries elapsed → the newest closed period is 71.
    expect(closed[closed.length - 1]).toBe(71);
    expect(closed[0]).toBe(72 - MAX_PERIOD_LOOKBACK);
  });

  it("honours an explicit lookback", () => {
    expect(periodsToClose(ANCHOR, new Date("2026-08-20T09:00:00Z"), 2)).toEqual([
      3, 4,
    ]);
  });

  it("returns periods oldest-first so invoices are issued in order", () => {
    const closed = periodsToClose(ANCHOR, new Date("2026-07-20T09:00:00Z"));
    expect(closed).toEqual([...closed].sort((a, b) => a - b));
  });

  it("respects month-end anchoring (31 Jan → 28 Feb → 31 Mar)", () => {
    const jan31 = new Date("2026-01-31T00:00:00Z");
    // 1 March: February's period (index 0) closed on 28 Feb.
    expect(periodsToClose(jan31, new Date("2026-03-01T00:00:00Z"))).toEqual([0]);
    // 27 Feb: still inside period 0.
    expect(periodsToClose(jan31, new Date("2026-02-27T00:00:00Z"))).toEqual([]);
  });
});

describe("buildBillingAlerts", () => {
  it("raises nothing when the fleet is healthy and nothing is overdue", () => {
    expect(buildBillingAlerts({ fairUse: [], overdue: [] })).toEqual([]);
  });

  it("raises one warning per fair-use breach, keyed by device", () => {
    const alerts = buildBillingAlerts({
      fairUse: [{ deviceId: "dev_1", triggers: 412_000 }],
      overdue: [],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe("billing:fair-use:dev_1");
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].message).toContain("412,000");
  });

  it("raises one warning per overdue invoice, keyed by invoice", () => {
    const alerts = buildBillingAlerts({
      fairUse: [],
      overdue: [
        {
          invoiceId: "inv_1",
          orgName: "Roastwell Coffee",
          kind: "subscription",
          amountUsdCents: 54_000,
          dueAt: new Date("2026-08-01T00:00:00Z"),
        },
      ],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe("billing:invoice-overdue:inv_1");
    expect(alerts[0].message).toContain("Roastwell Coffee");
    expect(alerts[0].message).toContain("$540.00");
    expect(alerts[0].message).toContain("2026-08-01");
  });

  it("namespaces every key so the health sweep never resolves them", () => {
    const alerts = buildBillingAlerts({
      fairUse: [{ deviceId: "dev_1", triggers: 400_000 }],
      overdue: [
        {
          invoiceId: "inv_1",
          orgName: "Acme",
          kind: "overage",
          amountUsdCents: 100,
          dueAt: new Date("2026-08-01T00:00:00Z"),
        },
      ],
    });
    expect(alerts.every((a) => isBillingAlertKey(a.key))).toBe(true);
  });

  it("produces unique keys so the open-alert unique index holds", () => {
    const alerts = buildBillingAlerts({
      fairUse: [
        { deviceId: "dev_1", triggers: 400_000 },
        { deviceId: "dev_2", triggers: 500_000 },
      ],
      overdue: [],
    });
    expect(new Set(alerts.map((a) => a.key)).size).toBe(alerts.length);
  });
});

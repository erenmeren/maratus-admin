import { describe, it, expect } from "vitest";
import { rollupCredits } from "./credits-overview";

describe("rollupCredits", () => {
  const now = new Date("2026-07-04T12:00:00.000Z");

  const ledgerRows = [
    // Acme
    { orgId: "org_a", name: "Acme", kind: "grant" as const, credits: 50, createdAt: new Date("2026-06-01T00:00:00Z") },
    { orgId: "org_a", name: "Acme", kind: "purchase" as const, credits: 100, createdAt: new Date("2026-06-15T00:00:00Z") },
    { orgId: "org_a", name: "Acme", kind: "purchase" as const, credits: 20, createdAt: new Date("2026-07-02T00:00:00Z") },
    { orgId: "org_a", name: "Acme", kind: "settle" as const, credits: 10, createdAt: new Date("2026-06-20T00:00:00Z") },
    { orgId: "org_a", name: "Acme", kind: "settle" as const, credits: 5, createdAt: new Date("2026-07-03T00:00:00Z") },
    { orgId: "org_a", name: "Acme", kind: "hold" as const, credits: 3, createdAt: new Date("2026-07-03T00:00:00Z") },
    { orgId: "org_a", name: "Acme", kind: "release" as const, credits: 3, createdAt: new Date("2026-07-03T00:00:00Z") },
    // Beta
    { orgId: "org_b", name: "Beta", kind: "grant" as const, credits: 20, createdAt: new Date("2026-05-01T00:00:00Z") },
    { orgId: "org_b", name: "Beta", kind: "purchase" as const, credits: 50, createdAt: new Date("2026-06-10T00:00:00Z") },
    // exactly at the UTC month boundary — should count as "this month" (inclusive)
    { orgId: "org_b", name: "Beta", kind: "settle" as const, credits: 8, createdAt: new Date("2026-07-01T00:00:00.000Z") },
  ];

  const balances = [
    { orgId: "org_a", name: "Acme", available: 150 },
    { orgId: "org_b", name: "Beta", available: 40 },
    // Gamma has a balance (e.g. from a grant not modeled here) but no ledger rows in this fixture.
    { orgId: "org_c", name: "Gamma", available: 200 },
  ];

  it("sums granted/purchased/consumed totals and outstanding balance", () => {
    const r = rollupCredits(ledgerRows, balances, now);
    expect(r.totals.granted).toBe(70); // 50 + 20
    expect(r.totals.purchased).toBe(170); // 100 + 20 + 50
    expect(r.totals.consumed).toBe(23); // 10 + 5 + 8
    expect(r.totals.outstanding).toBe(390); // 150 + 40 + 200
  });

  it("ignores hold/release kinds in the totals", () => {
    const r = rollupCredits(ledgerRows, balances, now);
    // hold(3)/release(3) for org_a must not leak into any total.
    expect(r.totals.granted + r.totals.purchased + r.totals.consumed).toBe(70 + 170 + 23);
  });

  it("computes consumedThisMonth as settle credits >= UTC start-of-month, inclusive", () => {
    const r = rollupCredits(ledgerRows, balances, now);
    const acme = r.perTenant.find((t) => t.orgId === "org_a")!;
    const beta = r.perTenant.find((t) => t.orgId === "org_b")!;
    // Acme: only the 2026-07-03 settle(5) is in-month; the 2026-06-20 settle(10) is not.
    expect(acme.consumedThisMonth).toBe(5);
    // Beta: settle(8) lands exactly on the month boundary — must be included.
    expect(beta.consumedThisMonth).toBe(8);
  });

  it("computes lifetimePurchased per tenant across all time", () => {
    const r = rollupCredits(ledgerRows, balances, now);
    const acme = r.perTenant.find((t) => t.orgId === "org_a")!;
    const beta = r.perTenant.find((t) => t.orgId === "org_b")!;
    expect(acme.lifetimePurchased).toBe(120); // 100 + 20
    expect(beta.lifetimePurchased).toBe(50);
  });

  it("includes tenants that only appear in balances (no ledger rows)", () => {
    const r = rollupCredits(ledgerRows, balances, now);
    const gamma = r.perTenant.find((t) => t.orgId === "org_c")!;
    expect(gamma).toBeDefined();
    expect(gamma.name).toBe("Gamma");
    expect(gamma.balance).toBe(200);
    expect(gamma.consumedThisMonth).toBe(0);
    expect(gamma.lifetimePurchased).toBe(0);
  });

  it("sorts perTenant by balance descending", () => {
    const r = rollupCredits(ledgerRows, balances, now);
    expect(r.perTenant.map((t) => t.orgId)).toEqual(["org_c", "org_a", "org_b"]);
  });

  it("returns zero totals and empty perTenant for empty input", () => {
    const r = rollupCredits([], [], now);
    expect(r.totals).toEqual({ granted: 0, purchased: 0, consumed: 0, outstanding: 0 });
    expect(r.perTenant).toEqual([]);
  });
});

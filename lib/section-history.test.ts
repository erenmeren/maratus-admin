import { describe, expect, it, vi } from "vitest";

// lib/audit.ts imports the DB client; the constants are all this test needs.
vi.mock("@/lib/db", () => ({ db: {} }));

import { AUDIT } from "@/lib/audit";
import {
  HISTORY_SECTIONS,
  actionExcludePatternsFor,
  actionPatternsFor,
  decodeCursor,
  encodeCursor,
  sectionForAction,
} from "@/lib/section-history";

/** SQL LIKE (backslash escape) → anchored RegExp. */
function likeToRegex(pattern: string): RegExp {
  let src = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") src += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%") src += ".*";
    else if (c === "_") src += ".";
    else src += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${src}$`);
}

const matchesAny = (a: string, ps: string[]) => ps.some((p) => likeToRegex(p).test(a));

const DELIBERATELY_NONE = new Set<string>([
  AUDIT.orgCreated,
  AUDIT.orgSuspended,
  AUDIT.orgReactivated,
  AUDIT.customerCreated,
  AUDIT.customerRenamed,
  AUDIT.registryAllocated,
  AUDIT.registryDeallocated,
  AUDIT.registryClaimReverted,
  AUDIT.registryMarkedRma,
  AUDIT.registryRetired,
  AUDIT.registryReturnedToStock,
  AUDIT.registryAllocationConflict,
  AUDIT.orgArchived,
  AUDIT.orgRestored,
]);

describe("sectionForAction", () => {
  it.each([
    ["branding.updated", "branding"],
    ["device.pin_set", "pinnedQr"],
    ["store.pin_cleared", "pinnedQr"],
    ["org.pin_set", "pinnedQr"],
    ["device.renamed", "devices"],
    ["store.created", "stores"],
    ["device_settings.updated", "deviceSettings"],
    ["api_key.created", "api"],
    ["invoice.paid", "billing"],
    ["subscription.status_changed", "billing"],
    ["member.invited", "members"],
    ["invitation.canceled", "members"],
    ["registry.allocated", null],
    ["org.archived", null],
    ["credits.granted", null],
    ["customer.renamed", null],
  ])("%s → %s", (action, section) => {
    expect(sectionForAction(action)).toBe(section);
  });

  it("every AUDIT value lands in a section unless deliberately none", () => {
    for (const a of Object.values(AUDIT)) {
      expect(sectionForAction(a) === null, a).toBe(DELIBERATELY_NONE.has(a));
    }
  });
});

describe("actionPatternsFor", () => {
  it("escapes _ in the pinnedQr patterns", () => {
    expect(actionPatternsFor("pinnedQr")).toEqual(["org.pin\\_%", "store.pin\\_%", "device.pin\\_%"]);
  });

  it.each(HISTORY_SECTIONS)("%s: SQL filter agrees with sectionForAction for every AUDIT value", (section) => {
    for (const a of [...Object.values(AUDIT), "subscription.status_changed", "credits.granted"]) {
      const sqlMatch =
        matchesAny(a, actionPatternsFor(section)) && !matchesAny(a, actionExcludePatternsFor(section));
      expect(sqlMatch, `${section} / ${a}`).toBe(sectionForAction(a) === section);
    }
  });
});

describe("cursor", () => {
  it("round-trips", () => {
    const x = { at: new Date("2026-11-22T10:11:12.345Z"), id: "aud_abc" };
    expect(decodeCursor(encodeCursor(x))).toEqual(x);
  });

  it.each(["garbage", "", Buffer.from(JSON.stringify({ at: "nope", id: "x" })).toString("base64url")])("rejects %j", (s) => {
    expect(decodeCursor(s)).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import {
  canManageTenant,
  canView,
  canManage,
  firstViewableHref,
  TENANT_ROLES,
  SECTION_HREF,
  type Section,
} from "./roles";

const SECTIONS = Object.keys(SECTION_HREF) as Section[];
const ALL = SECTIONS;
const TABLE: Record<string, { view: Section[]; manage: Section[] }> = {
  owner: { view: ALL, manage: ALL },
  admin: { view: ALL, manage: ALL },
  member: { view: ALL, manage: [] },
  designer: { view: ["branding", "pinnedQr"], manage: ["branding", "pinnedQr"] },
  operations: {
    view: ["dashboard", "stores", "devices", "deviceSettings"],
    manage: ["stores", "devices", "deviceSettings"],
  },
  billing: { view: ["billing"], manage: [] },
  developer: { view: ["api", "stores", "devices"], manage: ["api"] },
};

describe("access table", () => {
  it("covers every role", () => {
    expect([...TENANT_ROLES].sort()).toEqual(Object.keys(TABLE).sort());
  });

  it.each(Object.entries(TABLE))("%s", (role, t) => {
    for (const s of SECTIONS) {
      expect(canView(role, s), `${role} view ${s}`).toBe(t.view.includes(s));
      expect(canManage(role, s), `${role} manage ${s}`).toBe(t.manage.includes(s));
    }
  });

  it("denies null / undefined / unknown roles", () => {
    expect(canView(null, "branding")).toBe(false);
    expect(canView("ghost", "dashboard")).toBe(false);
    expect(canManage(undefined, "api")).toBe(false);
  });

  it("manage implies view", () => {
    for (const r of TENANT_ROLES)
      for (const s of SECTIONS) if (canManage(r, s)) expect(canView(r, s)).toBe(true);
  });
});

describe("firstViewableHref", () => {
  it.each([
    ["owner", "/tenant"],
    ["admin", "/tenant"],
    ["member", "/tenant"],
    ["operations", "/tenant"],
    ["designer", "/tenant/pinned-qr"],
    ["billing", "/tenant/billing"],
    ["developer", "/tenant/stores"],
  ])("%s -> %s", (role, href) => {
    expect(firstViewableHref(role)).toBe(href);
  });

  it("returns null for unknown role", () => {
    expect(firstViewableHref("ghost")).toBeNull();
  });
});

describe("canManageTenant", () => {
  it("allows owner and admin", () => {
    expect(canManageTenant("owner")).toBe(true);
    expect(canManageTenant("admin")).toBe(true);
  });

  it("denies member (read-only)", () => {
    expect(canManageTenant("member")).toBe(false);
  });

  it("denies missing / empty / unknown roles", () => {
    expect(canManageTenant(undefined)).toBe(false);
    expect(canManageTenant(null)).toBe(false);
    expect(canManageTenant("")).toBe(false);
    expect(canManageTenant("viewer")).toBe(false);
  });
});

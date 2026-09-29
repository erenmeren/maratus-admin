import { describe, it, expect } from "vitest";
import { canManageMembers, inviteRoleIsValid, platformCanManage, shouldDeleteOrphanedUser } from "./members";

describe("canManageMembers", () => {
  it("allows owner and admin", () => {
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("admin")).toBe(true);
  });
  it("denies member and unknown/undefined", () => {
    expect(canManageMembers("member")).toBe(false);
    expect(canManageMembers(undefined)).toBe(false);
    expect(canManageMembers("guest")).toBe(false);
  });
});

describe("inviteRoleIsValid", () => {
  it("accepts admin/member only", () => {
    expect(inviteRoleIsValid("admin")).toBe(true);
    expect(inviteRoleIsValid("member")).toBe(true);
  });
  it("rejects owner and anything else", () => {
    expect(inviteRoleIsValid("owner")).toBe(false);
    expect(inviteRoleIsValid("")).toBe(false);
  });
});

describe("platformCanManage", () => {
  it("allows only what a platform admin invited", () => {
    expect(platformCanManage("platform_admin")).toBe(true);
  });
  it("denies customer-invited and unknown provenance", () => {
    expect(platformCanManage("user")).toBe(false);
    expect(platformCanManage(null)).toBe(false);
    expect(platformCanManage(undefined)).toBe(false);
  });
});

describe("shouldDeleteOrphanedUser", () => {
  it("deletes a plain user left with no memberships", () => {
    expect(shouldDeleteOrphanedUser("user", 0)).toBe(true);
  });
  it("keeps users still in another org", () => {
    expect(shouldDeleteOrphanedUser("user", 1)).toBe(false);
  });
  it("never deletes a platform admin", () => {
    expect(shouldDeleteOrphanedUser("platform_admin", 0)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { canManageMembers, inviteRoleIsValid } from "./members";

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

import { describe, it, expect } from "vitest";
import { canManageTenant } from "./roles";

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

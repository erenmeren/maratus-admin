import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("keeps a same-origin path", () => {
    expect(safeRedirectPath("/tenant/stores/st_1?x=1", "/tenant")).toBe("/tenant/stores/st_1?x=1");
  });
  it("falls back for absolute, protocol-relative and backslash forms", () => {
    expect(safeRedirectPath("https://evil.example", "/tenant")).toBe("/tenant");
    expect(safeRedirectPath("//evil.example", "/tenant")).toBe("/tenant");
    expect(safeRedirectPath("/\\evil.example", "/tenant")).toBe("/tenant");
    expect(safeRedirectPath("javascript:alert(1)", "/tenant")).toBe("/tenant");
  });
  it("falls back for null/empty", () => {
    expect(safeRedirectPath(null, "/tenant")).toBe("/tenant");
    expect(safeRedirectPath("", "/tenant")).toBe("/tenant");
  });
});

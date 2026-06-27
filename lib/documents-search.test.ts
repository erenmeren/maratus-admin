import { describe, it, expect } from "vitest";
import { parseDocumentFilters, documentPageCount, PAGE_SIZE } from "./documents-search";

describe("parseDocumentFilters", () => {
  it("defaults to page 1 and no filters on empty input", () => {
    expect(parseDocumentFilters({})).toEqual({ page: 1 });
  });
  it("keeps a valid status, drops an invalid one", () => {
    expect(parseDocumentFilters({ status: "ready" }).status).toBe("ready");
    expect(parseDocumentFilters({ status: "bogus" }).status).toBeUndefined();
  });
  it("clamps page to >= 1", () => {
    expect(parseDocumentFilters({ page: "0" }).page).toBe(1);
    expect(parseDocumentFilters({ page: "-4" }).page).toBe(1);
    expect(parseDocumentFilters({ page: "x" }).page).toBe(1);
    expect(parseDocumentFilters({ page: "3" }).page).toBe(3);
  });
  it("parses valid dates and drops garbage", () => {
    expect(parseDocumentFilters({ from: "2026-01-01" }).from).toBeInstanceOf(Date);
    expect(parseDocumentFilters({ from: "not-a-date" }).from).toBeUndefined();
  });
  it("makes a date-only `to` inclusive of the whole day", () => {
    const to = parseDocumentFilters({ to: "2026-06-03" }).to!;
    expect(to.getUTCFullYear()).toBe(2026);
    expect(to.getUTCDate()).toBe(3);
    expect(to.getUTCHours()).toBe(23);
    expect(to.getUTCMinutes()).toBe(59);
  });
  it("trims token/ids and drops empties", () => {
    expect(parseDocumentFilters({ token: "  abc  " }).token).toBe("abc");
    expect(parseDocumentFilters({ token: "   " }).token).toBeUndefined();
    expect(parseDocumentFilters({ store: "s1", device: "d1", org: "o1" })).toMatchObject({
      storeId: "s1",
      deviceId: "d1",
      organizationId: "o1",
    });
  });
});

describe("documentPageCount", () => {
  it("computes pages and never returns < 1", () => {
    expect(documentPageCount(0)).toBe(1);
    expect(documentPageCount(PAGE_SIZE)).toBe(1);
    expect(documentPageCount(PAGE_SIZE + 1)).toBe(2);
    expect(documentPageCount(PAGE_SIZE * 3)).toBe(3);
  });
});

import { describe, it, expect } from "vitest";
import { parseReceiptFilters, receiptPageCount, PAGE_SIZE } from "./receipts-search";

describe("parseReceiptFilters", () => {
  it("defaults to page 1 and no filters on empty input", () => {
    expect(parseReceiptFilters({})).toEqual({ page: 1 });
  });
  it("keeps a valid status, drops an invalid one", () => {
    expect(parseReceiptFilters({ status: "ready" }).status).toBe("ready");
    expect(parseReceiptFilters({ status: "bogus" }).status).toBeUndefined();
  });
  it("clamps page to >= 1", () => {
    expect(parseReceiptFilters({ page: "0" }).page).toBe(1);
    expect(parseReceiptFilters({ page: "-4" }).page).toBe(1);
    expect(parseReceiptFilters({ page: "x" }).page).toBe(1);
    expect(parseReceiptFilters({ page: "3" }).page).toBe(3);
  });
  it("parses valid dates and drops garbage", () => {
    expect(parseReceiptFilters({ from: "2026-01-01" }).from).toBeInstanceOf(Date);
    expect(parseReceiptFilters({ from: "not-a-date" }).from).toBeUndefined();
  });
  it("makes a date-only `to` inclusive of the whole day", () => {
    const to = parseReceiptFilters({ to: "2026-06-03" }).to!;
    expect(to.getUTCFullYear()).toBe(2026);
    expect(to.getUTCDate()).toBe(3);
    expect(to.getUTCHours()).toBe(23);
    expect(to.getUTCMinutes()).toBe(59);
  });
  it("trims token/ids and drops empties", () => {
    expect(parseReceiptFilters({ token: "  abc  " }).token).toBe("abc");
    expect(parseReceiptFilters({ token: "   " }).token).toBeUndefined();
    expect(parseReceiptFilters({ store: "s1", device: "d1", org: "o1" })).toMatchObject({
      storeId: "s1",
      deviceId: "d1",
      organizationId: "o1",
    });
  });
});

describe("receiptPageCount", () => {
  it("computes pages and never returns < 1", () => {
    expect(receiptPageCount(0)).toBe(1);
    expect(receiptPageCount(PAGE_SIZE)).toBe(1);
    expect(receiptPageCount(PAGE_SIZE + 1)).toBe(2);
    expect(receiptPageCount(PAGE_SIZE * 3)).toBe(3);
  });
});

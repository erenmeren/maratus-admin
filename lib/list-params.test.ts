import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE,
  escapeLike,
  pageCount,
  parseListParams,
} from "./list-params";

describe("parseListParams", () => {
  it("defaults: empty q, status all, page 1", () => {
    expect(parseListParams({})).toEqual({ q: "", status: "all", page: 1 });
  });
  it("trims q and caps it at 100 chars", () => {
    expect(parseListParams({ q: "  b580  " }).q).toBe("b580");
    expect(parseListParams({ q: "x".repeat(150) }).q).toHaveLength(100);
  });
  it("accepts every valid status and rejects junk", () => {
    for (const s of ["all", "online", "offline", "paused", "pool"] as const) {
      expect(parseListParams({ status: s }).status).toBe(s);
    }
    expect(parseListParams({ status: "hacked" }).status).toBe("all");
  });
  it("clamps page to a positive integer", () => {
    expect(parseListParams({ page: "3" }).page).toBe(3);
    for (const bad of ["0", "-2", "abc", "1.5", ""]) {
      expect(parseListParams({ page: bad }).page).toBe(1);
    }
  });
  it("takes the first value when Next hands an array", () => {
    expect(parseListParams({ q: ["a", "b"], page: ["2"] })).toEqual({
      q: "a",
      status: "all",
      page: 2,
    });
  });
});

describe("pageCount", () => {
  it("is ceil(total/size) with a floor of 1", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(1)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
    expect(pageCount(101, 50)).toBe(3);
  });
});

describe("escapeLike", () => {
  it("escapes backslash, percent and underscore", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });
  it("leaves plain text alone", () => {
    expect(escapeLike("kadikoy 12")).toBe("kadikoy 12");
  });
});

describe("PAGE_SIZE", () => {
  it("is 50 per the spec", () => {
    expect(PAGE_SIZE).toBe(50);
  });
});

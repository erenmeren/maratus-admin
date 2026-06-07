import { describe, it, expect } from "vitest";
import { parseListParams } from "./params";

const sp = (q: string) => new URLSearchParams(q);

describe("parseListParams", () => {
  it("defaults limit to 50 and accepts no filters", () => {
    const r = parseListParams(sp(""));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ limit: 50 });
  });
  it("clamps limit to 1..100", () => {
    expect((parseListParams(sp("limit=1000")) as any).value.limit).toBe(100);
    expect((parseListParams(sp("limit=0")) as any).value.limit).toBe(50);
    expect((parseListParams(sp("limit=25")) as any).value.limit).toBe(25);
  });
  it("parses filters", () => {
    const r = parseListParams(sp("store_id=str_1&device_id=dev_1&status=ready&token=tok"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.storeId).toBe("str_1");
      expect(r.value.deviceId).toBe("dev_1");
      expect(r.value.status).toBe("ready");
      expect(r.value.token).toBe("tok");
    }
  });
  it("parses ISO dates", () => {
    const r = parseListParams(sp("created_after=2026-06-01T00:00:00Z"));
    if (r.ok) expect(r.value.createdAfter instanceof Date).toBe(true);
    else throw new Error("expected ok");
  });
  it("rejects an invalid status", () => {
    const r = parseListParams(sp("status=bogus"));
    expect(r.ok).toBe(false);
  });
  it("rejects an unparseable date", () => {
    const r = parseListParams(sp("created_after=not-a-date"));
    expect(r.ok).toBe(false);
  });
});

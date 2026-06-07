import { describe, it, expect } from "vitest";
import { encodeCursor, decodeCursor } from "./cursor";

describe("cursor", () => {
  it("round-trips an encoded cursor", () => {
    const c = { t: "2026-06-07T12:00:00.000Z", id: "rcp_abc123" };
    const decoded = decodeCursor(encodeCursor(c));
    expect(decoded).toEqual(c);
  });
  it("produces a url-safe opaque string", () => {
    const s = encodeCursor({ t: "2026-06-07T12:00:00.000Z", id: "rcp_abc" });
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("returns null for garbage", () => {
    expect(decodeCursor("!!!notbase64!!!")).toBeNull();
    expect(decodeCursor(btoa("not json"))).toBeNull();
  });
  it("returns null when fields are missing or the date is invalid", () => {
    expect(decodeCursor(btoa(JSON.stringify({ id: "x" })))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ t: "nope", id: "x" })))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ t: "2026-06-07T12:00:00.000Z" })))).toBeNull();
  });
});

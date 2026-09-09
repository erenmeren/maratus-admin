import { describe, expect, it } from "vitest";
import { isExpiredPending } from "./command-expiry";

const NOW = new Date("2026-09-09T10:00:00Z");

describe("isExpiredPending", () => {
  it("is true for a pending row whose expiresAt has passed", () => {
    expect(isExpiredPending({ status: "pending", expiresAt: new Date("2026-09-09T09:59:00Z") }, NOW)).toBe(true);
  });
  it("is false while the TTL is still open", () => {
    expect(isExpiredPending({ status: "pending", expiresAt: new Date("2026-09-09T10:00:30Z") }, NOW)).toBe(false);
  });
  it("never expires desired-state rows (null expiresAt) or terminal rows", () => {
    expect(isExpiredPending({ status: "pending", expiresAt: null }, NOW)).toBe(false);
    expect(isExpiredPending({ status: "acked", expiresAt: new Date("2026-09-09T09:00:00Z") }, NOW)).toBe(false);
  });
});

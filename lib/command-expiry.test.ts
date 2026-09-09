import { describe, expect, it } from "vitest";
import { isExpiredPending, isUndeliveredTrigger } from "./command-expiry";

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

describe("isUndeliveredTrigger", () => {
  const inWindow = new Date("2026-09-09T02:00:00Z");   // 8h before NOW
  const outOfWindow = new Date("2026-09-07T10:00:00Z"); // 48h before NOW

  it("counts an expired trigger inside the window", () => {
    expect(
      isUndeliveredTrigger(
        { type: "trigger", status: "expired", expiresAt: new Date("2026-09-09T02:01:00Z"), createdAt: inWindow },
        NOW,
      ),
    ).toBe(true);
  });
  it("counts a pending trigger whose TTL has passed (sweep hasn't run yet)", () => {
    expect(
      isUndeliveredTrigger(
        { type: "trigger", status: "pending", expiresAt: new Date("2026-09-09T02:01:00Z"), createdAt: inWindow },
        NOW,
      ),
    ).toBe(true);
  });
  it("does not count a pending trigger whose TTL is still open", () => {
    expect(
      isUndeliveredTrigger(
        { type: "trigger", status: "pending", expiresAt: new Date("2026-09-09T10:00:30Z"), createdAt: new Date("2026-09-09T09:59:30Z") },
        NOW,
      ),
    ).toBe(false);
  });
  it("does not count an acked trigger", () => {
    expect(
      isUndeliveredTrigger(
        { type: "trigger", status: "acked", expiresAt: new Date("2026-09-09T02:01:00Z"), createdAt: inWindow },
        NOW,
      ),
    ).toBe(false);
  });
  it("does not count an expired trigger older than the window", () => {
    expect(
      isUndeliveredTrigger(
        { type: "trigger", status: "expired", expiresAt: new Date("2026-09-07T10:01:00Z"), createdAt: outOfWindow },
        NOW,
      ),
    ).toBe(false);
  });
  it("ignores non-trigger commands (pin, config-changed, …)", () => {
    expect(
      isUndeliveredTrigger(
        { type: "pin", status: "expired", expiresAt: new Date("2026-09-09T02:01:00Z"), createdAt: inWindow },
        NOW,
      ),
    ).toBe(false);
  });
  it("honours an explicit window override", () => {
    expect(
      isUndeliveredTrigger(
        { type: "trigger", status: "expired", expiresAt: inWindow, createdAt: inWindow },
        NOW,
        60 * 60 * 1000,
      ),
    ).toBe(false);
  });
});

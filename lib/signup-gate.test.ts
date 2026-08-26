import { describe, expect, it } from "vitest";
import { decideSignUp } from "./signup-gate";

const NOW = new Date("2026-08-26T12:00:00Z");
const future = new Date("2026-08-27T12:00:00Z");
const past = new Date("2026-08-25T12:00:00Z");

describe("decideSignUp", () => {
  it("blocks sign-up when there is no invitation at all", () => {
    expect(decideSignUp({ invitations: [], now: NOW })).toEqual({
      ok: false,
      reason: "no_pending_invitation",
    });
  });

  it("allows sign-up for a pending, unexpired invitation", () => {
    expect(
      decideSignUp({ invitations: [{ status: "pending", expiresAt: future }], now: NOW }),
    ).toEqual({ ok: true });
  });

  it("blocks an expired invitation", () => {
    expect(
      decideSignUp({ invitations: [{ status: "pending", expiresAt: past }], now: NOW }),
    ).toEqual({ ok: false, reason: "no_pending_invitation" });
  });

  it("blocks an already-accepted invitation (link can't be reused)", () => {
    expect(
      decideSignUp({ invitations: [{ status: "accepted", expiresAt: future }], now: NOW }),
    ).toEqual({ ok: false, reason: "no_pending_invitation" });
  });

  it("blocks a canceled invitation", () => {
    expect(
      decideSignUp({ invitations: [{ status: "canceled", expiresAt: future }], now: NOW }),
    ).toEqual({ ok: false, reason: "no_pending_invitation" });
  });

  it("allows when any one of several invitations is still usable", () => {
    expect(
      decideSignUp({
        invitations: [
          { status: "accepted", expiresAt: future },
          { status: "pending", expiresAt: past },
          { status: "pending", expiresAt: future },
        ],
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });
});

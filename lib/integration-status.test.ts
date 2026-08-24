import { describe, it, expect } from "vitest";
import { emailStatus, senderDomain } from "./integration-status";

describe("senderDomain", () => {
  it("reads the domain out of a display-name address", () => {
    expect(senderDomain("Maratus <noreply@maratus.co>")).toBe("maratus.co");
  });
  it("reads a bare address and lowercases it", () => {
    expect(senderDomain("NoReply@Maratus.Co")).toBe("maratus.co");
  });
  it("returns null when there is no domain", () => {
    expect(senderDomain("not-an-address")).toBeNull();
    expect(senderDomain("trailing@")).toBeNull();
  });
});

describe("emailStatus", () => {
  const verified = [{ name: "maratus.co", status: "verified" }];

  it("is disabled without a key — sends are skipped, not failed", () => {
    const s = emailStatus({ apiKey: undefined, from: "Maratus <noreply@maratus.co>", domains: verified });
    expect(s.state).toBe("disabled");
  });

  it("flags the shared sandbox sender even though the app thinks it is configured", () => {
    const s = emailStatus({
      apiKey: "re_live_xxx",
      from: "Maratus <onboarding@resend.dev>",
      domains: [],
    });
    expect(s.state).toBe("sandbox");
    expect(s.detail).toMatch(/only delivers to the Resend account owner/);
  });

  it("treats a custom sender on an unknown domain as unverified", () => {
    const s = emailStatus({ apiKey: "re_live_xxx", from: "noreply@example.com", domains: verified });
    expect(s.state).toBe("unverified");
  });

  it("treats a domain still pending DNS as unverified", () => {
    const s = emailStatus({
      apiKey: "re_live_xxx",
      from: "noreply@maratus.co",
      domains: [{ name: "maratus.co", status: "pending" }],
    });
    expect(s.state).toBe("unverified");
  });

  it("never claims ready when the domain list could not be read", () => {
    const s = emailStatus({ apiKey: "re_live_xxx", from: "noreply@maratus.co", domains: null });
    expect(s.state).toBe("unknown");
  });

  it("is ready only with a key, a custom sender and a verified domain", () => {
    const s = emailStatus({ apiKey: "re_live_xxx", from: "Maratus <noreply@maratus.co>", domains: verified });
    expect(s.state).toBe("ready");
  });
});

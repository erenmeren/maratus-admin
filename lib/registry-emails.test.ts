import { describe, it, expect } from "vitest";
import { autoClaimEmail } from "./registry-emails";

const base = {
  serial: "a1b2c3d4e5f6",
  orgName: "Roastwell Coffee",
  deviceId: "dev_123",
  claimedAt: new Date("2026-07-10T18:32:00Z"),
};

describe("autoClaimEmail", () => {
  it("subject includes the serial", () => {
    expect(autoClaimEmail(base).subject).toBe("Device auto-claimed: a1b2c3d4e5f6");
  });

  it("body includes serial, org name, device id, and a UTC timestamp", () => {
    const { html } = autoClaimEmail(base);
    expect(html).toContain("a1b2c3d4e5f6");
    expect(html).toContain("Roastwell Coffee");
    expect(html).toContain("dev_123");
    expect(html).toContain("2026-07-10 18:32 UTC");
  });

  it("links the hijack-recovery runbook", () => {
    expect(autoClaimEmail(base).html).toContain("factory-registry-hijack-recovery.md");
  });

  it("escapes a malicious org name", () => {
    const { html } = autoClaimEmail({ ...base, orgName: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

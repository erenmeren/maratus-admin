import { describe, it, expect } from "vitest";
import {
  expiresInLabel,
  memberInviteEmail,
  ownerInviteEmail,
  resetPasswordEmail,
  verifyEmailEmail,
} from "./auth-emails";

describe("expiresInLabel", () => {
  it("speaks hours under two days and whole days beyond", () => {
    expect(expiresInLabel(3600_000)).toBe("in 1 hour");
    expect(expiresInLabel(24 * 3600_000)).toBe("in 24 hours");
    expect(expiresInLabel(48 * 3600_000)).toBe("in 2 days");
    expect(expiresInLabel(7 * 24 * 3600_000 - 500)).toBe("in 7 days");
  });
});

describe("account emails", () => {
  const url = "https://console.maratus.co/x?token=abc";

  it("every mail carries its link, the logo and the fallback link", () => {
    for (const m of [
      resetPasswordEmail({ url, expiresIn: "in 1 hour" }),
      verifyEmailEmail({ url, email: "a@b.co", expiresIn: "in 1 hour" }),
      memberInviteEmail({ url, inviterName: "Dana", orgName: "Roastwell", role: "admin", expiresIn: "in 2 days" }),
      ownerInviteEmail({ url, orgName: "Roastwell", expiresIn: "in 7 days" }),
    ]) {
      expect(m.html).toContain(`href="${url}"`);
      expect(m.html).toContain("maratus-logo-light.png");
      expect(m.html).toContain("Paste this link");
    }
  });

  it("escapes user-controlled names and strips newlines from subjects", () => {
    const m = memberInviteEmail({
      url,
      inviterName: "<b>Eve</b>",
      orgName: "Evil\r\nBcc: x@y.z <script>",
      role: "member",
      expiresIn: "in 2 days",
    });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>Eve</b>");
    expect(m.html).toContain("&lt;b&gt;Eve&lt;/b&gt;");
    expect(ownerInviteEmail({ url, orgName: "A\nB", expiresIn: "in 7 days" }).subject).toBe(
      "You're invited to own A B on Maratus",
    );
  });

  it("states the expiry", () => {
    expect(resetPasswordEmail({ url, expiresIn: "in 1 hour" }).html).toContain("expires in 1 hour");
  });
});

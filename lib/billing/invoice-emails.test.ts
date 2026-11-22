import { describe, it, expect } from "vitest";
import { escapeHtml, emailLayout, pickOrgContact } from "./invoice-emails";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("emailLayout", () => {
  it("wraps the body with the Maratus wordmark", () => {
    const html = emailLayout("<p>hi</p>");
    expect(html).toContain("Maratus");
    expect(html).toContain("<p>hi</p>");
  });
});

describe("pickOrgContact", () => {
  const r = (role: string) => ({ role, email: `${role}@x.co` });
  it("prefers owner, then admin, then member", () => {
    expect(pickOrgContact([r("member"), r("admin"), r("owner")])?.role).toBe("owner");
    expect(pickOrgContact([r("member"), r("admin")])?.role).toBe("admin");
    expect(pickOrgContact([r("designer"), r("member")])?.role).toBe("member");
  });
  it("never falls back to a scoped role", () => {
    expect(pickOrgContact([r("designer"), r("operations"), r("billing"), r("developer")])).toBeNull();
    expect(pickOrgContact([])).toBeNull();
  });
});

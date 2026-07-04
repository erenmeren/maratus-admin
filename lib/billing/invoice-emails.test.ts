import { describe, it, expect } from "vitest";
import { escapeHtml, emailLayout } from "./invoice-emails";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("emailLayout", () => {
  it("wraps the body with the Ditto wordmark", () => {
    const html = emailLayout("<p>hi</p>");
    expect(html).toContain("Ditto");
    expect(html).toContain("<p>hi</p>");
  });
});

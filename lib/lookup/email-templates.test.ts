import { describe, it, expect } from "vitest";
import { documentEmail, lookupEmail } from "./email-templates";

describe("email templates", () => {
  it("documentEmail includes the org name and link, HTML-escaped", () => {
    const { subject, html } = documentEmail({
      orgName: "Tom & Jerry's",
      documentUrl: "https://x.test/d/abc",
    });
    expect(subject).toContain("Tom & Jerry's");
    expect(html).toContain("https://x.test/d/abc");
    expect(html).toContain("Tom &amp; Jerry&#39;s"); // escaped in body
  });

  it("lookupEmail includes the recovery link", () => {
    const { subject, html } = lookupEmail({
      orgName: "Roastwell",
      recoveryUrl: "https://x.test/d/lookup/org_1/tok",
    });
    expect(subject).toContain("Roastwell");
    expect(html).toContain("https://x.test/d/lookup/org_1/tok");
  });
});

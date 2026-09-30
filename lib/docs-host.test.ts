import { describe, it, expect } from "vitest";
import { isDocsHost } from "./docs-host";

describe("isDocsHost", () => {
  it("matches the docs host, ignoring case and port", () => {
    expect(isDocsHost("docs.maratus.co")).toBe(true);
    expect(isDocsHost("DOCS.maratus.co:443")).toBe(true);
  });
  it("rejects every other host", () => {
    expect(isDocsHost("console.maratus.co")).toBe(false);
    expect(isDocsHost("docs.maratus.co.evil.com")).toBe(false);
    expect(isDocsHost(null)).toBe(false);
  });
});

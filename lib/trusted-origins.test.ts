import { describe, it, expect } from "vitest";
import { computeTrustedOrigins } from "./trusted-origins";

describe("computeTrustedOrigins", () => {
  const prod = computeTrustedOrigins("https://api.maratus.co", true);

  it("trusts every custom domain aliased to the prod deployment", () => {
    // Better Auth validates the Origin header on any request carrying cookies
    // or Sec-Fetch metadata (= every real browser). A domain missing here
    // fails browser logins with INVALID_ORIGIN even though bare curl passes.
    expect(prod).toContain("https://api.maratus.co");
    expect(prod).toContain("https://console.maratus.co");
    expect(prod).toContain("https://docs.maratus.co");
    expect(prod).toContain("https://api.maratus.dev");
    expect(prod).toContain("https://*.vercel.app");
  });

  it("includes the configured base URL even if it is not a known alias", () => {
    expect(computeTrustedOrigins("https://elsewhere.example", true)).toContain(
      "https://elsewhere.example",
    );
  });

  it("trusts localhost only outside production", () => {
    expect(prod).not.toContain("http://localhost:*");
    expect(computeTrustedOrigins("http://localhost:3000", false)).toContain(
      "http://localhost:*",
    );
  });
});

import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey } from "./ids";

describe("generateApiKey", () => {
  it("returns a dk_live_ key, its sha256 hash, and a visible prefix", () => {
    const { key, hash, prefix } = generateApiKey();
    expect(key).toMatch(/^dk_live_[A-Za-z0-9_-]{40}$/);
    expect(hash).toBe(hashApiKey(key));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(key.startsWith(prefix)).toBe(true);
    expect(prefix).toBe(`dk_live_${key.slice("dk_live_".length, "dk_live_".length + 6)}`);
  });
  it("is unique across calls", () => {
    expect(generateApiKey().key).not.toBe(generateApiKey().key);
  });
});

describe("hashApiKey", () => {
  it("is deterministic", () => {
    expect(hashApiKey("dk_live_abc")).toBe(hashApiKey("dk_live_abc"));
  });
});

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signPayload } from "./sign";
import { generateWebhookSecret } from "@/lib/ids";

describe("signPayload", () => {
  it("produces t=<ts>,v1=<hmac> over `ts.payload`", () => {
    const sig = signPayload(`{"a":1}`, "whsec_test", 1700000000);
    const expected = createHmac("sha256", "whsec_test").update(`1700000000.{"a":1}`).digest("hex");
    expect(sig).toBe(`t=1700000000,v1=${expected}`);
  });
  it("is deterministic and secret-dependent", () => {
    expect(signPayload("p", "s1", 1)).toBe(signPayload("p", "s1", 1));
    expect(signPayload("p", "s1", 1)).not.toBe(signPayload("p", "s2", 1));
  });
});

describe("generateWebhookSecret", () => {
  it("returns a whsec_ token", () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_[A-Za-z0-9_-]{40}$/);
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});

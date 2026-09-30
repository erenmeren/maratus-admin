import { describe, it, expect } from "vitest";
import openapi from "../openapi.json";
import {
  EXAMPLE_DEVICE_ID,
  EXAMPLE_IDEMPOTENCY_KEY,
  EXAMPLE_STORE_ID,
  freshIdempotencyKey,
  personalizeSpec,
} from "./docs-spec";

describe("personalizeSpec", () => {
  it("the placeholders it replaces are really in the spec", () => {
    const text = JSON.stringify(openapi);
    expect(text).toContain(EXAMPLE_DEVICE_ID);
    expect(text).toContain(EXAMPLE_STORE_ID);
    expect(text).toContain(EXAMPLE_IDEMPOTENCY_KEY);
  });
  it("swaps every example ID for the visitor's own", () => {
    const text = JSON.stringify(personalizeSpec({ deviceId: "dev_mine", storeId: "str_mine" }));
    expect(text).not.toContain(EXAMPLE_DEVICE_ID);
    expect(text).not.toContain(EXAMPLE_STORE_ID);
    expect(text).toContain("dev_mine");
    expect(text).toContain("str_mine");
  });
  it("leaves a placeholder alone when the visitor has none of that kind", () => {
    const text = JSON.stringify(personalizeSpec({ storeId: "str_mine" }));
    expect(text).toContain(EXAMPLE_DEVICE_ID);
  });
});

describe("freshIdempotencyKey", () => {
  it("replaces the example key with a new one on every call", () => {
    let n = 0;
    const next = () => `key-${++n}`;
    const a = new Headers({ "Idempotency-Key": EXAMPLE_IDEMPOTENCY_KEY });
    const b = new Headers({ "Idempotency-Key": EXAMPLE_IDEMPOTENCY_KEY });
    freshIdempotencyKey(a, next);
    freshIdempotencyKey(b, next);
    expect(a.get("idempotency-key")).toBe("key-1");
    expect(b.get("idempotency-key")).toBe("key-2");
  });
  it("keeps a key the visitor typed, and adds none when absent", () => {
    const typed = new Headers({ "Idempotency-Key": "my-own" });
    freshIdempotencyKey(typed, () => "x");
    expect(typed.get("idempotency-key")).toBe("my-own");
    const none = new Headers();
    freshIdempotencyKey(none, () => "x");
    expect(none.has("idempotency-key")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { validateReceiptPayload, MAX_RECEIPT_BYTES } from "./ingest-validation";

describe("validateReceiptPayload", () => {
  it("accepts a normal-sized image/png", () => {
    expect(validateReceiptPayload(1024, "image/png")).toEqual({ ok: true });
  });

  it("rejects an empty payload", () => {
    expect(validateReceiptPayload(0, "image/png")).toEqual({
      ok: false,
      status: 400,
      error: "Empty receipt payload",
    });
  });

  it("rejects an over-size payload", () => {
    const res = validateReceiptPayload(MAX_RECEIPT_BYTES + 1, "image/png");
    expect(res).toEqual({ ok: false, status: 413, error: "Receipt image too large" });
  });

  it("rejects a non-image mime type", () => {
    const res = validateReceiptPayload(1024, "application/pdf");
    expect(res).toEqual({ ok: false, status: 415, error: "Unsupported media type" });
  });
});

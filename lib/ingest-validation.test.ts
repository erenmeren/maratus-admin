import { describe, it, expect } from "vitest";
import { validateDocumentPayload, MAX_DOCUMENT_BYTES } from "./ingest-validation";

describe("validateDocumentPayload", () => {
  it("accepts a normal-sized image/png", () => {
    expect(validateDocumentPayload(1024, "image/png")).toEqual({ ok: true });
  });

  it("rejects an empty payload", () => {
    expect(validateDocumentPayload(0, "image/png")).toEqual({
      ok: false,
      status: 400,
      error: "Empty document payload",
    });
  });

  it("rejects an over-size payload", () => {
    const res = validateDocumentPayload(MAX_DOCUMENT_BYTES + 1, "image/png");
    expect(res).toEqual({ ok: false, status: 413, error: "Document image too large" });
  });

  it("rejects a non-image mime type", () => {
    const res = validateDocumentPayload(1024, "application/pdf");
    expect(res).toEqual({ ok: false, status: 415, error: "Unsupported media type" });
  });
});

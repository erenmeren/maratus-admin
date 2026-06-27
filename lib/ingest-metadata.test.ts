// lib/ingest-metadata.test.ts
import { describe, it, expect } from "vitest";
import { parseDocumentMetadata } from "./ingest-metadata";

describe("parseDocumentMetadata", () => {
  it("returns null for non-objects and empty input", () => {
    expect(parseDocumentMetadata(null)).toBeNull();
    expect(parseDocumentMetadata("nope")).toBeNull();
    expect(parseDocumentMetadata({})).toBeNull();
    expect(parseDocumentMetadata({ junk: 1 })).toBeNull();
  });

  it("keeps and coerces valid technical fields", () => {
    const m = parseDocumentMetadata({
      renderWidth: 576,
      renderHeight: 1840,
      contentHash: "a1b2c3",
      firmwareVersion: "2.4.1",
      renderMs: 312,
    });
    expect(m).toEqual({
      renderWidth: 576,
      renderHeight: 1840,
      contentHash: "a1b2c3",
      firmwareVersion: "2.4.1",
      renderMs: 312,
    });
  });

  it("clamps out-of-range numbers and drops invalid ones", () => {
    const m = parseDocumentMetadata({ renderWidth: 0, renderHeight: 99999, renderMs: -5 });
    expect(m).toEqual({ renderHeight: 10000 }); // width 0 dropped, height clamped, negative ms dropped
  });

  it("truncates over-long strings and ignores non-strings", () => {
    const m = parseDocumentMetadata({ contentHash: "x".repeat(100), firmwareVersion: 123 });
    expect(m).toEqual({ contentHash: "x".repeat(64) });
  });

  it("ignores unknown keys", () => {
    expect(parseDocumentMetadata({ total: 4200, renderWidth: 384 })).toEqual({ renderWidth: 384 });
  });
});

import { describe, it, expect } from "vitest";
import { latestFirmwareManifest } from "./firmware";
import { firmwareStorageKey } from "./storage";

describe("latestFirmwareManifest", () => {
  it("returns null when there is no release", () => {
    expect(latestFirmwareManifest(null, null)).toBeNull();
  });
  it("returns null when there is no url", () => {
    expect(latestFirmwareManifest({ version: "1", sha256: "a", sizeBytes: 1 }, null)).toBeNull();
  });
  it("builds the manifest from a release + presigned url", () => {
    expect(
      latestFirmwareManifest({ version: "0.3.0", sha256: "deadbeef", sizeBytes: 1599264 }, "https://r2/sig"),
    ).toEqual({ version: "0.3.0", url: "https://r2/sig", sha256: "deadbeef", size: 1599264 });
  });
});

describe("firmwareStorageKey", () => {
  it("namespaces by version", () => {
    expect(firmwareStorageKey("0.3.0")).toBe("firmware/0.3.0/ditto-firmware.bin");
  });
});

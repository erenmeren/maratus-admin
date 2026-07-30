import { describe, it, expect } from "vitest";
import { deviceCommand } from "@/lib/db/schema";
import { republishKindFor, isFirmwareBehindLatest } from "./mqtt-push";

describe("isFirmwareBehindLatest", () => {
  it("is true when the device is behind by patch", () => {
    expect(isFirmwareBehindLatest("0.18.0", "0.18.1")).toBe(true);
  });

  it("is true when the device is behind by minor", () => {
    expect(isFirmwareBehindLatest("0.17.1", "0.18.0")).toBe(true);
  });

  it("is true when the device is behind by major", () => {
    expect(isFirmwareBehindLatest("0.18.0", "1.0.0")).toBe(true);
  });

  it("is false when versions are equal", () => {
    expect(isFirmwareBehindLatest("0.18.0", "0.18.0")).toBe(false);
  });

  it("is false when the device is ahead by patch", () => {
    expect(isFirmwareBehindLatest("0.18.1", "0.18.0")).toBe(false);
  });

  it("is false when the device is ahead by minor", () => {
    // The production incident this helper fixes: heartbeat's OTA reconcile
    // used to gate on firmwareUpdateAvailable ("differs from latest"), which
    // is true here too and pushed 0.18.0 devices backward to 0.17.1.
    expect(isFirmwareBehindLatest("0.18.0", "0.17.1")).toBe(false);
  });

  it("resolves the 0.9.0 vs 0.18.0 ordering trap numerically, both directions", () => {
    // "0.9.0" > "0.18.0" lexicographically — a string comparison would call
    // the device "ahead" here when it is actually far behind.
    expect(isFirmwareBehindLatest("0.9.0", "0.18.0")).toBe(true);
    // And the reverse must not be behind either.
    expect(isFirmwareBehindLatest("0.18.0", "0.9.0")).toBe(false);
  });

  it("reads a build-label suffix as the numeric version it labels, on either side", () => {
    expect(isFirmwareBehindLatest("0.6.0-m6b", "0.18.0")).toBe(true);
    expect(isFirmwareBehindLatest("0.18.0", "0.19.0-rc1")).toBe(true);
  });

  it("is false when the device version is null", () => {
    expect(isFirmwareBehindLatest(null, "0.18.0")).toBe(false);
  });

  it("is false when the latest version is null", () => {
    expect(isFirmwareBehindLatest("0.17.1", null)).toBe(false);
  });

  it("is false when either version is an empty string", () => {
    expect(isFirmwareBehindLatest("", "0.18.0")).toBe(false);
    expect(isFirmwareBehindLatest("0.17.1", "")).toBe(false);
  });

  it("is false when either version is unparseable garbage", () => {
    expect(isFirmwareBehindLatest("abc", "0.18.0")).toBe(false);
    expect(isFirmwareBehindLatest("0.17.1", "0.18.0garbage")).toBe(false);
  });
});

describe("republishKindFor", () => {
  it("regenerates config commands instead of replaying them", () => {
    // A stored config payload replayed 60s later would carry expired 300s
    // presigned R2 URLs, so the heartbeat republish must rebuild it.
    expect(republishKindFor("config-changed")).toBe("config");
  });

  it("regenerates firmware-update commands", () => {
    // The manifest url is a 600s presigned GET — same expiry problem.
    expect(republishKindFor("firmware-update")).toBe("ota");
  });

  it("partitions the whole schema command-type enum", () => {
    // Driven off deviceCommand.type's enum ON PURPOSE, and asserted as an exact
    // partition: a new payload-carrying type added to the schema would otherwise
    // fall silently into "replay" and ship a dead presigned URL with this test
    // still green. Failing here forces the author to classify it.
    const byKind: Record<string, string[]> = { config: [], ota: [], replay: [] };
    for (const t of deviceCommand.type.enumValues) byKind[republishKindFor(t)].push(t);
    expect({
      config: byKind.config.sort(),
      ota: byKind.ota.sort(),
      replay: byKind.replay.sort(),
    }).toEqual({
      config: ["config-changed"],
      ota: ["firmware-update"],
      replay: ["identify", "pin", "reboot", "refresh", "trigger"],
    });
  });

  it("replays unknown types rather than dropping them", () => {
    expect(republishKindFor("something-new")).toBe("replay");
  });
});

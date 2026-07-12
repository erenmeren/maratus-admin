import { describe, it, expect } from "vitest";
import {
  classifyClaimPoll,
  normalizeSerial,
  isValidPairingCode,
  shouldAutoClaim,
} from "./provisioning";

describe("classifyClaimPoll", () => {
  it("returns pending when no device row matches the code", () => {
    expect(classifyClaimPoll(null)).toEqual({ status: "pending", consume: false });
  });

  it("delivers the key and consumes when a claim is pending fetch", () => {
    expect(classifyClaimPoll({ pendingDeviceKey: "dvk_abc" })).toEqual({
      status: "claimed",
      deviceKey: "dvk_abc",
      consume: true,
    });
  });

  it("returns claimed without a key once already delivered", () => {
    expect(classifyClaimPoll({ pendingDeviceKey: null })).toEqual({
      status: "claimed",
      consume: false,
    });
  });
});

describe("normalizeSerial", () => {
  it("lowercases and strips separators", () => {
    expect(normalizeSerial("84:F7:03:AA:BB:CC")).toBe("84f703aabbcc");
    expect(normalizeSerial("84-F7-03-AA-BB-CC")).toBe("84f703aabbcc");
    expect(normalizeSerial("84f703aabbcc")).toBe("84f703aabbcc");
  });
  it("rejects wrong length, non-hex, and empty input", () => {
    expect(normalizeSerial("84f703aabb")).toBeNull();
    expect(normalizeSerial("84f703aabbccdd")).toBeNull();
    expect(normalizeSerial("84f703aabbgg")).toBeNull();
    expect(normalizeSerial("")).toBeNull();
    expect(normalizeSerial(null)).toBeNull();
    expect(normalizeSerial(undefined)).toBeNull();
  });
});

describe("isValidPairingCode", () => {
  it("accepts the firmware XXXX-XXXX shape (32-char unambiguous alphabet)", () => {
    expect(isValidPairingCode("7K3F-9QXM")).toBe(true);
    expect(isValidPairingCode("ABCD-2345")).toBe(true);
  });
  it("rejects ambiguous chars, missing dash, wrong length, lowercase", () => {
    expect(isValidPairingCode("7K3F9QXM")).toBe(false);   // no dash
    expect(isValidPairingCode("7K3F-9QX")).toBe(false);   // short
    expect(isValidPairingCode("7K3F-9QXMM")).toBe(false); // long
    expect(isValidPairingCode("7K3F-9QX0")).toBe(false);  // 0 not in alphabet
    expect(isValidPairingCode("7K3F-9QXI")).toBe(false);  // I not in alphabet
    expect(isValidPairingCode("7k3f-9qxm")).toBe(false);  // lowercase
    expect(isValidPairingCode("")).toBe(false);
  });
});

describe("shouldAutoClaim", () => {
  const allocated = {
    status: "allocated" as const,
    allocatedOrganizationId: "org_1",
    allocatedStoreId: "str_1",
  };
  it("fires only for a fully-allocated serial with no device row", () => {
    expect(shouldAutoClaim(false, allocated)).toBe(true);
  });
  it("never fires when a device row already matches the code", () => {
    expect(shouldAutoClaim(true, allocated)).toBe(false);
  });
  it("never fires without a registry row", () => {
    expect(shouldAutoClaim(false, null)).toBe(false);
  });
  it("never fires for non-allocated statuses (hijack guard)", () => {
    for (const status of ["manufactured", "claimed", "rma", "retired"] as const) {
      expect(shouldAutoClaim(false, { ...allocated, status })).toBe(false);
    }
  });
  it("never fires when the allocation lacks an org", () => {
    expect(shouldAutoClaim(false, { ...allocated, allocatedOrganizationId: null })).toBe(false);
  });
  it("fires for a store-less allocation — the device claims into the org pool", () => {
    expect(shouldAutoClaim(false, { ...allocated, allocatedStoreId: null })).toBe(true);
  });
});

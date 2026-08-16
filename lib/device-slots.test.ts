import { describe, expect, it } from "vitest";
import { freeSlots, slotsAfterPayment } from "./device-slots";

describe("freeSlots", () => {
  it("is the entitlement minus what occupies it", () => {
    expect(freeSlots({ paidDeviceSlots: 3, paidDevices: 2 })).toBe(1);
  });

  it("is zero when every slot is occupied", () => {
    expect(freeSlots({ paidDeviceSlots: 3, paidDevices: 3 })).toBe(0);
  });

  it("clamps to zero when more devices are paid than slots exist", () => {
    // A data anomaly must degrade to "no free slot", never to free activations.
    expect(freeSlots({ paidDeviceSlots: 2, paidDevices: 5 })).toBe(0);
  });

  it("is zero for an org with no entitlement", () => {
    expect(freeSlots({ paidDeviceSlots: 0, paidDevices: 0 })).toBe(0);
  });

  it("frees a slot when a paid device leaves", () => {
    // The RMA case: entitlement holds, occupancy drops.
    expect(freeSlots({ paidDeviceSlots: 2, paidDevices: 1 })).toBe(1);
  });
});

describe("slotsAfterPayment", () => {
  it("sets the entitlement from a first subscription invoice", () => {
    expect(
      slotsAfterPayment({ kind: "subscription", currentSlots: 0, invoiceDeviceCount: 3 }),
    ).toBe(3);
  });

  it("overwrites the entitlement at renewal, including downward", () => {
    // A customer who dropped from 3 devices to 1 renews at 1.
    expect(
      slotsAfterPayment({ kind: "subscription", currentSlots: 3, invoiceDeviceCount: 1 }),
    ).toBe(1);
  });

  it("increments by one for a proration", () => {
    expect(
      slotsAfterPayment({ kind: "proration", currentSlots: 2, invoiceDeviceCount: 1 }),
    ).toBe(3);
  });

  it("leaves the entitlement alone for an overage", () => {
    expect(
      slotsAfterPayment({ kind: "overage", currentSlots: 2, invoiceDeviceCount: null }),
    ).toBe(2);
  });

  it("treats a null subscription deviceCount as zero rather than throwing", () => {
    expect(
      slotsAfterPayment({ kind: "subscription", currentSlots: 5, invoiceDeviceCount: null }),
    ).toBe(0);
  });

  it("never returns a negative entitlement", () => {
    expect(
      slotsAfterPayment({ kind: "subscription", currentSlots: 2, invoiceDeviceCount: -1 }),
    ).toBe(0);
  });
});

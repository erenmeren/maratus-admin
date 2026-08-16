import { describe, expect, it } from "vitest";
import { freeSlots, slotsAfterPayment, unpricedSlots } from "./device-slots";

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

describe("unpricedSlots", () => {
  it("is zero when the invoice covers every paid device", () => {
    expect(unpricedSlots({ invoiceDeviceCount: 2, paidDevices: 2 })).toBe(0);
  });

  it("is zero when the invoice was priced for more than is occupied", () => {
    // The customer paid for a slot that now sits empty — their money, their
    // slot. Nothing to surface.
    expect(unpricedSlots({ invoiceDeviceCount: 3, paidDevices: 1 })).toBe(0);
  });

  it("counts the lead-window device the renewal was never priced for", () => {
    // Renewal issued at 1 device; a replacement then claimed into the still
    // vacant slot for free before the renewal was paid, so 2 slots get
    // written against an invoice for 1.
    expect(unpricedSlots({ invoiceDeviceCount: 1, paidDevices: 2 })).toBe(1);
  });

  it("treats a null deviceCount as zero", () => {
    expect(unpricedSlots({ invoiceDeviceCount: null, paidDevices: 2 })).toBe(2);
  });
});

describe("slotsAfterPayment", () => {
  it("sets the entitlement from a first subscription invoice", () => {
    expect(
      slotsAfterPayment({
        kind: "subscription",
        currentSlots: 0,
        invoiceDeviceCount: 3,
        paidDevices: 3,
      }),
    ).toBe(3);
  });

  it("overwrites the entitlement at renewal, including downward, when it's a genuine reduction", () => {
    // A customer who dropped from 3 devices to 1 renews at 1 — the other two
    // are already unpaid, so paidDevices has already fallen to 1 too.
    expect(
      slotsAfterPayment({
        kind: "subscription",
        currentSlots: 3,
        invoiceDeviceCount: 1,
        paidDevices: 1,
      }),
    ).toBe(1);
  });

  it("does not reduce the entitlement below devices already paid for and occupied", () => {
    // The renewal was priced at 3 (issuance time), but a 4th device was
    // prorated and paid for in the lead window before the renewal itself was
    // paid — paidDevices is now 4. Replacing down to 3 would confiscate a
    // slot the customer already paid for with a separate invoice.
    expect(
      slotsAfterPayment({
        kind: "subscription",
        currentSlots: 3,
        invoiceDeviceCount: 3,
        paidDevices: 4,
      }),
    ).toBe(4);
  });

  it("increments by one for a proration", () => {
    expect(
      slotsAfterPayment({
        kind: "proration",
        currentSlots: 2,
        invoiceDeviceCount: 1,
        paidDevices: 3,
      }),
    ).toBe(3);
  });

  it("leaves the entitlement alone for an overage", () => {
    expect(
      slotsAfterPayment({
        kind: "overage",
        currentSlots: 2,
        invoiceDeviceCount: null,
        paidDevices: 2,
      }),
    ).toBe(2);
  });

  it("treats a null subscription deviceCount as zero rather than throwing", () => {
    expect(
      slotsAfterPayment({
        kind: "subscription",
        currentSlots: 5,
        invoiceDeviceCount: null,
        paidDevices: 0,
      }),
    ).toBe(0);
  });

  it("never returns a negative entitlement", () => {
    expect(
      slotsAfterPayment({
        kind: "subscription",
        currentSlots: 2,
        invoiceDeviceCount: -1,
        paidDevices: 0,
      }),
    ).toBe(0);
  });
});

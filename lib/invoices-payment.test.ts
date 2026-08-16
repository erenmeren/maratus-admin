import { describe, expect, it } from "vitest";
import { devicesForFreeSlots } from "./invoices";
import { freeSlots, slotsAfterPayment } from "./device-slots";

// markInvoicePaid's activation step is now bounded by the entitlement itself
// (freeSlots / slotsAfterPayment, exhaustively tested in device-slots.test.ts)
// rather than by devicesToActivate/activatableDeviceCount, which this file
// used to test. Those two pure functions were deleted along with the guards
// they backed. What replaced their ORDERING role — oldest-claimed-first,
// bounded by however many slots are free — is `devicesForFreeSlots`, tested
// below. Eligibility (which devices even reach that list — claimed, unpaid,
// and not an RMA'd/retired unit) is a DB concern and lives in the query in
// lib/invoices.ts (`unpaidClaimedDevices`), not here.

describe("the slot bound subsumes the old activation guards", () => {
  it("a renewal priced at the already-paid count leaves zero free slots", () => {
    // The cron issues renewals with deviceCount = countPaidDevices(org), so
    // slotsAfterPayment REPLACES the entitlement with that same number.
    const newSlots = slotsAfterPayment({
      kind: "subscription",
      currentSlots: 3,
      invoiceDeviceCount: 3,
      paidDevices: 3,
    });
    expect(newSlots).toBe(3);
    // A device claimed during the renewal lead window (D4) is unpaid and
    // holds its own open proration, but there is no free slot for it to
    // occupy — it is not activated by this payment.
    expect(freeSlots({ paidDeviceSlots: newSlots, paidDevices: 3 })).toBe(0);
  });

  it("a paid device that went to RMA frees exactly one slot for a replacement", () => {
    // Same org: 3 slots paid for, but only 2 devices are currently paid
    // (one was RMA'd and its subscriptionPaidAt cleared). The renewal was
    // priced at 3 before the RMA, so the invoice's own number is unaffected.
    const newSlots = slotsAfterPayment({
      kind: "subscription",
      currentSlots: 3,
      invoiceDeviceCount: 3,
      paidDevices: 2,
    });
    expect(freeSlots({ paidDeviceSlots: newSlots, paidDevices: 2 })).toBe(1);
  });

  it("a proration payment adds exactly one slot", () => {
    expect(
      slotsAfterPayment({
        kind: "proration",
        currentSlots: 3,
        invoiceDeviceCount: null,
        paidDevices: 4,
      }),
    ).toBe(4);
  });
});

describe("devicesForFreeSlots", () => {
  it("takes the oldest claimed devices first (caller supplies that order)", () => {
    expect(
      devicesForFreeSlots({
        eligibleDeviceIds: ["oldest", "newer"],
        freeSlots: 1,
      }),
    ).toEqual(["oldest"]);
  });

  it("never activates more than are free", () => {
    expect(
      devicesForFreeSlots({
        eligibleDeviceIds: ["a", "b", "c"],
        freeSlots: 2,
      }),
    ).toEqual(["a", "b"]);
  });

  it("activates nothing when no slot is free", () => {
    expect(
      devicesForFreeSlots({
        eligibleDeviceIds: ["a"],
        freeSlots: 0,
      }),
    ).toEqual([]);
  });

  it("never activates more than exist, even with more free slots than devices", () => {
    expect(
      devicesForFreeSlots({
        eligibleDeviceIds: ["a"],
        freeSlots: 5,
      }),
    ).toEqual(["a"]);
  });
});

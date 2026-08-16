import { describe, expect, it } from "vitest";
import { freeSlots, slotsAfterPayment } from "./device-slots";

// markInvoicePaid's activation step is now bounded by the entitlement itself
// (freeSlots / slotsAfterPayment, tested in device-slots.test.ts) rather than
// by devicesToActivate/activatableDeviceCount, which this file used to test.
// Those two pure functions were deleted along with the guards they backed —
// see lib/invoices.ts markInvoicePaid for the replacement and the trace of
// why the renewal and RMA scenarios both still close.

describe("the slot bound subsumes the old activation guards", () => {
  it("a renewal priced at the already-paid count leaves zero free slots", () => {
    // The cron issues renewals with deviceCount = countPaidDevices(org), so
    // slotsAfterPayment REPLACES the entitlement with that same number.
    const newSlots = slotsAfterPayment({
      kind: "subscription",
      currentSlots: 3,
      invoiceDeviceCount: 3,
    });
    expect(newSlots).toBe(3);
    // A device claimed during the renewal lead window (D4) is unpaid and
    // holds its own open proration, but there is no free slot for it to
    // occupy — it is not activated by this payment.
    expect(freeSlots({ paidDeviceSlots: newSlots, paidDevices: 3 })).toBe(0);
  });

  it("a paid device that went to RMA frees exactly one slot for a replacement", () => {
    // Same org: 3 slots paid for, but only 2 devices are currently paid
    // (one was RMA'd and its subscriptionPaidAt cleared).
    const newSlots = slotsAfterPayment({
      kind: "subscription",
      currentSlots: 3,
      invoiceDeviceCount: 3,
    });
    expect(freeSlots({ paidDeviceSlots: newSlots, paidDevices: 2 })).toBe(1);
  });

  it("a proration payment adds exactly one slot", () => {
    expect(
      slotsAfterPayment({
        kind: "proration",
        currentSlots: 3,
        invoiceDeviceCount: null,
      }),
    ).toBe(4);
  });
});

import { describe, expect, it } from "vitest";
import { activatableDeviceCount, devicesToActivate } from "./invoices";

/** No device is separately invoiced — the common case. */
const NONE: ReadonlySet<string> = new Set<string>();

describe("devicesToActivate", () => {
  it("activates exactly the invoiced device count", () => {
    expect(
      devicesToActivate({
        deviceCount: 2,
        unpaidDeviceIds: ["a", "b", "c"],
        proratedDeviceIds: NONE,
      }),
    ).toEqual(["a", "b"]);
  });

  it("takes the oldest claimed devices first (caller supplies that order)", () => {
    expect(
      devicesToActivate({
        deviceCount: 1,
        unpaidDeviceIds: ["oldest", "newer"],
        proratedDeviceIds: NONE,
      }),
    ).toEqual(["oldest"]);
  });

  it("never activates more than exist", () => {
    expect(
      devicesToActivate({
        deviceCount: 5,
        unpaidDeviceIds: ["a"],
        proratedDeviceIds: NONE,
      }),
    ).toEqual(["a"]);
  });

  it("activates nothing for a zero-device invoice", () => {
    expect(
      devicesToActivate({
        deviceCount: 0,
        unpaidDeviceIds: ["a"],
        proratedDeviceIds: NONE,
      }),
    ).toEqual([]);
  });

  it("never activates a device that already holds a proration invoice", () => {
    expect(
      devicesToActivate({
        deviceCount: 2,
        unpaidDeviceIds: ["D4", "D5"],
        proratedDeviceIds: new Set(["D4"]),
      }),
    ).toEqual(["D5"]);
  });

  it("filters before slicing, so a separately-invoiced device burns no slot", () => {
    // D4 is oldest and pro-rated; the one available slot must still reach D5.
    expect(
      devicesToActivate({
        deviceCount: 1,
        unpaidDeviceIds: ["D4", "D5"],
        proratedDeviceIds: new Set(["D4"]),
      }),
    ).toEqual(["D5"]);
  });

  it("activates the whole first-subscription set when nothing is pro-rated yet", () => {
    // Before the first payment the anchor is null, so no proration can exist —
    // the exclusion must not strand a device the first invoice legitimately
    // paid for.
    expect(
      devicesToActivate({
        deviceCount: 3,
        unpaidDeviceIds: ["D1", "D2", "D3"],
        proratedDeviceIds: NONE,
      }),
    ).toEqual(["D1", "D2", "D3"]);
  });
});

describe("activatableDeviceCount", () => {
  it("activates the whole invoice at first subscription (nothing paid yet)", () => {
    expect(
      activatableDeviceCount({ invoicedDeviceCount: 3, alreadyPaidCount: 0 }),
    ).toBe(3);
  });

  it("activates nothing on a renewal priced from the already-paid devices", () => {
    // The cron issues renewals with deviceCount = countPaidDevices(org).
    expect(
      activatableDeviceCount({ invoicedDeviceCount: 3, alreadyPaidCount: 3 }),
    ).toBe(0);
  });

  it("does not activate a device claimed during the renewal lead window", () => {
    // 3 paid devices, renewal deviceCount = 3, D4 claimed later and unpaid.
    const remaining = activatableDeviceCount({
      invoicedDeviceCount: 3,
      alreadyPaidCount: 3,
    });
    expect(
      devicesToActivate({
        deviceCount: remaining,
        unpaidDeviceIds: ["D4"],
        proratedDeviceIds: NONE,
      }),
    ).toEqual([]);
  });

  it("never goes negative when more devices are paid than the invoice covered", () => {
    expect(
      activatableDeviceCount({ invoicedDeviceCount: 2, alreadyPaidCount: 5 }),
    ).toBe(0);
  });

  it("activates only the shortfall on a partially-paid subscription", () => {
    expect(
      activatableDeviceCount({ invoicedDeviceCount: 5, alreadyPaidCount: 2 }),
    ).toBe(3);
  });

  it("a deleted paid device frees a slot, but a pro-rated device may not take it", () => {
    // 3 paid devices; D4 claimed 1 Jul with its own open proration; renewal
    // issued 1 Aug for deviceCount 3; D1 deleted 5 Aug; renewal paid 20 Aug.
    // alreadyPaid is now 2, so the count guard leaves one slot open, and D4
    // passes the claimedAt <= issuedAt pin. Only the proration exclusion stops
    // D4 riding free while its own invoice stays open.
    const remaining = activatableDeviceCount({
      invoicedDeviceCount: 3,
      alreadyPaidCount: 2,
    });
    expect(remaining).toBe(1);
    expect(
      devicesToActivate({
        deviceCount: remaining,
        unpaidDeviceIds: ["D4"],
        proratedDeviceIds: new Set(["D4"]),
      }),
    ).toEqual([]);
  });
});

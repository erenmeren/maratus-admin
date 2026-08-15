import { describe, expect, it } from "vitest";
import { activatableDeviceCount, devicesToActivate } from "./invoices";

describe("devicesToActivate", () => {
  it("activates exactly the invoiced device count", () => {
    expect(
      devicesToActivate({ deviceCount: 2, unpaidDeviceIds: ["a", "b", "c"] }),
    ).toEqual(["a", "b"]);
  });

  it("takes the oldest claimed devices first (caller supplies that order)", () => {
    expect(
      devicesToActivate({ deviceCount: 1, unpaidDeviceIds: ["oldest", "newer"] }),
    ).toEqual(["oldest"]);
  });

  it("never activates more than exist", () => {
    expect(devicesToActivate({ deviceCount: 5, unpaidDeviceIds: ["a"] })).toEqual(["a"]);
  });

  it("activates nothing for a zero-device invoice", () => {
    expect(devicesToActivate({ deviceCount: 0, unpaidDeviceIds: ["a"] })).toEqual([]);
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
    expect(devicesToActivate({ deviceCount: remaining, unpaidDeviceIds: ["D4"] })).toEqual([]);
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
});

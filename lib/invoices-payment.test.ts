import { describe, expect, it } from "vitest";
import { devicesToActivate } from "./invoices";

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

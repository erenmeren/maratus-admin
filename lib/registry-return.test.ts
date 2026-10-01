import { describe, it, expect } from "vitest";
import { returnToStockBlocker } from "./registry-return";

describe("returnToStockBlocker", () => {
  it("allows rma/retired with no device", () => {
    expect(returnToStockBlocker({ status: "rma", deviceId: null })).toBeNull();
    expect(returnToStockBlocker({ status: "retired", deviceId: null })).toBeNull();
  });
  it("refuses while a device row is still linked", () => {
    expect(returnToStockBlocker({ status: "rma", deviceId: "dev_1" })).toMatch(/Delete the device first/);
  });
  it("is a no-op marker for manufactured", () => {
    expect(returnToStockBlocker({ status: "manufactured", deviceId: null })).toBe("noop");
  });
  it("refuses allocated/claimed (use the existing deallocate / revert flows)", () => {
    expect(returnToStockBlocker({ status: "allocated", deviceId: null })).toMatch(/RMA or retired/);
    expect(returnToStockBlocker({ status: "claimed", deviceId: null })).toMatch(/RMA or retired/);
  });
});

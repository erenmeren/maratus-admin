import { describe, it, expect } from "vitest";
import { defaultDeviceName } from "./device-name";

describe("defaultDeviceName", () => {
  it("starts at device_1", () => {
    expect(defaultDeviceName([])).toBe("device_1");
  });
  it("uses highest suffix + 1, not a count (gaps from deletions)", () => {
    expect(defaultDeviceName(["device_1", "device_7"])).toBe("device_8");
  });
  it("ignores names that do not match exactly", () => {
    expect(defaultDeviceName(["Printer a1b2", "device_x", "my device_9", "device_2b"])).toBe("device_1");
  });
});

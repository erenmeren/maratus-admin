import { describe, it, expect } from "vitest";
import openapi from "../openapi.json";
import { EXAMPLE_DEVICE_ID, EXAMPLE_STORE_ID, personalizeSpec } from "./docs-spec";

describe("personalizeSpec", () => {
  it("the placeholders it replaces are really in the spec", () => {
    const text = JSON.stringify(openapi);
    expect(text).toContain(EXAMPLE_DEVICE_ID);
    expect(text).toContain(EXAMPLE_STORE_ID);
  });
  it("swaps every example ID for the visitor's own", () => {
    const text = JSON.stringify(personalizeSpec({ deviceId: "dev_mine", storeId: "str_mine" }));
    expect(text).not.toContain(EXAMPLE_DEVICE_ID);
    expect(text).not.toContain(EXAMPLE_STORE_ID);
    expect(text).toContain("dev_mine");
    expect(text).toContain("str_mine");
  });
  it("leaves a placeholder alone when the visitor has none of that kind", () => {
    const text = JSON.stringify(personalizeSpec({ storeId: "str_mine" }));
    expect(text).toContain(EXAMPLE_DEVICE_ID);
  });
});

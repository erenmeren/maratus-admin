import { describe, it, expect } from "vitest";
import { defaultImageUrl } from "./default-images";

describe("defaultImageUrl", () => {
  it("builds an absolute /defaults URL with no double slash", () => {
    const u = defaultImageUrl("check");
    expect(u).toMatch(/\/defaults\/check\.png$/);
    expect(u).not.toMatch(/([^:])\/\//); // no accidental double slash outside protocol
  });

  it("supports wifi-off", () => {
    const u = defaultImageUrl("wifi-off");
    expect(u).toMatch(/^https?:\/\//);
    expect(u).toMatch(/\/defaults\/wifi-off\.png$/);
  });
});

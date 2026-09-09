import { describe, expect, it, vi } from "vitest";
import { withPinClaim } from "./pin-idempotency";

describe("withPinClaim", () => {
  it("returns the work's result and releases nothing on success", async () => {
    const release = vi.fn(async () => {});
    await expect(withPinClaim({ nsKey: "pin:k", organizationId: "org" }, async () => 42, release)).resolves.toBe(42);
    expect(release).not.toHaveBeenCalled();
  });
  it("releases the claim and rethrows when the work throws", async () => {
    const release = vi.fn(async () => {});
    await expect(
      withPinClaim({ nsKey: "pin:k", organizationId: "org" }, async () => { throw new Error("db down"); }, release),
    ).rejects.toThrow("db down");
    expect(release).toHaveBeenCalledWith("pin:k", "org");
  });
  it("does not release when no key was claimed", async () => {
    const release = vi.fn(async () => {});
    await expect(
      withPinClaim({ nsKey: null, organizationId: "org" }, async () => { throw new Error("x"); }, release),
    ).rejects.toThrow("x");
    expect(release).not.toHaveBeenCalled();
  });
});

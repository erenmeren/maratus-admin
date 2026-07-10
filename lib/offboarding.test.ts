import { describe, it, expect } from "vitest";
import {
  deriveArchivedStatus,
  partitionDispositions,
  buildOffboardMetadata,
} from "./offboarding";

describe("deriveArchivedStatus", () => {
  it("is active when archivedAt is null/undefined", () => {
    expect(deriveArchivedStatus(null)).toBe("active");
    expect(deriveArchivedStatus(undefined)).toBe("active");
  });
  it("is archived when archivedAt is a Date or ISO string", () => {
    expect(deriveArchivedStatus(new Date())).toBe("archived");
    expect(deriveArchivedStatus("2026-07-10T00:00:00.000Z")).toBe("archived");
  });
});

describe("partitionDispositions", () => {
  it("splits ids by disposition, preserving order", () => {
    const choices = [
      { deviceId: "d1", disposition: "return_to_stock" as const },
      { deviceId: "d2", disposition: "leave_with_customer" as const },
      { deviceId: "d3", disposition: "return_to_stock" as const },
    ];
    expect(partitionDispositions(choices)).toEqual({
      returnIds: ["d1", "d3"],
      leaveIds: ["d2"],
    });
  });
  it("handles an empty list", () => {
    expect(partitionDispositions([])).toEqual({ returnIds: [], leaveIds: [] });
  });
});

describe("buildOffboardMetadata", () => {
  it("packs summary counts + note into a flat record", () => {
    const meta = buildOffboardMetadata(
      { returnedToStock: 2, leftWithCustomer: 1, revokedKeys: 3, sweptAllocations: 1, frozenCreditsAvailable: 500, frozenCreditsHeld: 0 },
      "contract ended",
    );
    expect(meta).toEqual({
      returnedToStock: 2,
      leftWithCustomer: 1,
      revokedKeys: 3,
      sweptAllocations: 1,
      frozenCreditsAvailable: 500,
      frozenCreditsHeld: 0,
      note: "contract ended",
    });
  });
  it("omits note when null", () => {
    const meta = buildOffboardMetadata(
      { returnedToStock: 0, leftWithCustomer: 0, revokedKeys: 0, sweptAllocations: 0, frozenCreditsAvailable: 0, frozenCreditsHeld: 0 },
      null,
    );
    expect(meta).not.toHaveProperty("note");
  });
});

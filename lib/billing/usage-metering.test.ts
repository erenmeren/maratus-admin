import { describe, it, expect } from "vitest";
// nextUsageStatus is the pure state machine; it's also re-exported from
// ./usage-metering. Import the IO-free module directly so this test doesn't pull
// in the DB client (which validates env at load), matching the billing-status convention.
import { nextUsageStatus } from "./usage-status";

describe("nextUsageStatus", () => {
  it("pending + success + customer → reported", () => {
    expect(nextUsageStatus("pending", true, true)).toBe("reported");
  });

  it("pending + failure + customer → pending (eligible for retry)", () => {
    expect(nextUsageStatus("pending", false, true)).toBe("pending");
  });

  it("pending + no customer → skipped (nothing to bill)", () => {
    expect(nextUsageStatus("pending", false, false)).toBe("skipped");
    // hasCustomer=false wins even if a report somehow 'succeeded'.
    expect(nextUsageStatus("pending", true, false)).toBe("skipped");
  });

  it("reported is terminal — never transitions", () => {
    expect(nextUsageStatus("reported", false, true)).toBe("reported");
    expect(nextUsageStatus("reported", true, true)).toBe("reported");
    expect(nextUsageStatus("reported", false, false)).toBe("reported");
  });

  it("skipped is terminal — never transitions", () => {
    expect(nextUsageStatus("skipped", true, true)).toBe("skipped");
    expect(nextUsageStatus("skipped", false, true)).toBe("skipped");
    expect(nextUsageStatus("skipped", false, false)).toBe("skipped");
  });
});

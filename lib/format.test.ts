import { describe, expect, it } from "vitest";
import { formatDate } from "./format";

describe("formatDate", () => {
  // Midday UTC keeps the calendar day the same in every runtime timezone.
  const iso = "2026-08-15T12:00:00.000Z";

  it("formats an ISO string as a fixed en-US calendar date", () => {
    expect(formatDate(iso)).toBe("Aug 15, 2026");
  });

  it("accepts a Date and matches the string form", () => {
    expect(formatDate(new Date(iso))).toBe("Aug 15, 2026");
  });

  it("does not use day-first or numeric locale output", () => {
    expect(formatDate("2026-11-01T12:00:00.000Z")).toBe("Nov 1, 2026");
  });

  it("uses the UTC calendar day near midnight", () => {
    expect(formatDate("2026-11-01T23:30:00.000Z")).toBe("Nov 1, 2026");
    expect(formatDate("2026-11-02T00:30:00.000Z")).toBe("Nov 2, 2026");
  });
});

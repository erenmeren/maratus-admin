import { describe, expect, it } from "vitest";
import { excludeArchived } from "./archived";

describe("excludeArchived", () => {
  it("drops rows with archivedAt set, keeps null", () => {
    const rows = [
      { id: "a", archivedAt: null },
      { id: "b", archivedAt: new Date("2026-07-10") },
      { id: "c", archivedAt: null },
    ];
    expect(excludeArchived(rows).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("returns an empty array untouched", () => {
    expect(excludeArchived([])).toEqual([]);
  });
});

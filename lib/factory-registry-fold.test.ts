import { describe, it, expect } from "vitest";
import { foldDeallocatedByOrg, clampPage } from "./factory-registry-fold";

describe("foldDeallocatedByOrg", () => {
  it("groups multiple serials under multiple orgs", () => {
    const before = [
      { serial: "s1", organizationId: "org-a" },
      { serial: "s2", organizationId: "org-a" },
      { serial: "s3", organizationId: "org-b" },
    ];
    const updated = ["s1", "s2", "s3"];
    expect(foldDeallocatedByOrg(before, updated)).toEqual({
      "org-a": ["s1", "s2"],
      "org-b": ["s3"],
    });
  });

  it("excludes serials present in updated but not in before", () => {
    const before = [{ serial: "s1", organizationId: "org-a" }];
    const updated = ["s1", "s2"]; // s2 not in before
    expect(foldDeallocatedByOrg(before, updated)).toEqual({ "org-a": ["s1"] });
  });

  it("excludes serials present in before but not in updated", () => {
    const before = [
      { serial: "s1", organizationId: "org-a" },
      { serial: "s2", organizationId: "org-a" },
    ];
    const updated = ["s1"]; // s2 didn't actually get updated (raced away)
    expect(foldDeallocatedByOrg(before, updated)).toEqual({ "org-a": ["s1"] });
  });

  it("skips rows with a null organizationId", () => {
    const before = [
      { serial: "s1", organizationId: null },
      { serial: "s2", organizationId: "org-a" },
    ];
    const updated = ["s1", "s2"];
    expect(foldDeallocatedByOrg(before, updated)).toEqual({ "org-a": ["s2"] });
  });

  it("returns an empty object for empty inputs", () => {
    expect(foldDeallocatedByOrg([], [])).toEqual({});
  });
});

describe("clampPage", () => {
  it("clamps an over-range requested page to the last page", () => {
    expect(clampPage(99, 100, 50)).toEqual({ safePage: 2, pageCount: 2 });
  });

  it("returns page 1 / pageCount 1 when total is zero", () => {
    expect(clampPage(1, 0, 50)).toEqual({ safePage: 1, pageCount: 1 });
  });

  it("floors a fractional requested page", () => {
    expect(clampPage(2.9, 500, 50)).toEqual({ safePage: 2, pageCount: 10 });
  });

  it("treats a negative requested page as 1", () => {
    expect(clampPage(-5, 100, 50)).toEqual({ safePage: 1, pageCount: 2 });
  });

  it("treats a NaN requested page as 1", () => {
    expect(clampPage(NaN, 100, 50)).toEqual({ safePage: 1, pageCount: 2 });
  });
});

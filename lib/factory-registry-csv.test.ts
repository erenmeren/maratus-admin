import { describe, it, expect } from "vitest";
import { parseRegistryCsv } from "./factory-registry-csv";

describe("parseRegistryCsv", () => {
  it("parses full rows with a header", () => {
    const { rows, errors } = parseRegistryCsv(
      "serial,batch,hw_rev,manufactured_at\n84:F7:03:AA:BB:CC,B2026-07,rev-b,2026-07-01\n",
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        serial: "84f703aabbcc",
        batchCode: "B2026-07",
        hardwareRevision: "rev-b",
        manufacturedAt: new Date("2026-07-01"),
      },
    ]);
  });
  it("parses serial-only rows without a header", () => {
    const { rows, errors } = parseRegistryCsv("84f703aabbcc\n84f703aabbcd\n");
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.serial)).toEqual(["84f703aabbcc", "84f703aabbcd"]);
    expect(rows[0]).toMatchObject({ batchCode: null, hardwareRevision: null, manufacturedAt: null });
  });
  it("reports invalid serials and bad dates with 1-based line numbers, keeps good rows", () => {
    const { rows, errors } = parseRegistryCsv(
      "serial,batch,hw_rev,manufactured_at\nnot-a-mac,B1,,\n84f703aabbcc,B1,,not-a-date\n",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].serial).toBe("84f703aabbcc");
    expect(rows[0].manufacturedAt).toBeNull();
    expect(errors).toEqual([
      'line 2: invalid serial "not-a-mac"',
      'line 3: invalid manufactured_at "not-a-date" (row kept, date dropped)',
    ]);
  });
  it("dedupes serials within a file (last row wins) and skips blank lines", () => {
    const { rows, errors } = parseRegistryCsv(
      "84f703aabbcc,B1,,\n\n84f703aabbcc,B2,,\n",
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { serial: "84f703aabbcc", batchCode: "B2", hardwareRevision: null, manufacturedAt: null },
    ]);
  });
});

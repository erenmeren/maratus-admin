// Pure CSV parsing for factory-registry imports. DB-free so it stays
// unit-testable; lib/factory-registry.ts applies the parsed rows.

import { normalizeSerial } from "./provisioning";

export interface RegistryCsvRow {
  serial: string;
  batchCode: string | null;
  hardwareRevision: string | null;
  manufacturedAt: Date | null;
}

export interface RegistryCsvResult {
  rows: RegistryCsvRow[];
  errors: string[];
}

/**
 * Parse a registry CSV: `serial[,batch[,hw_rev[,manufactured_at]]]`. A first
 * line containing "serial" is treated as a header. Serials are normalized;
 * invalid serials error the line, invalid dates keep the row but drop the
 * date. Duplicate serials within one file dedupe with last-row-wins.
 */
export function parseRegistryCsv(text: string): RegistryCsvResult {
  const bySerial = new Map<string, RegistryCsvRow>();
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return;
    if (idx === 0 && line.toLowerCase().includes("serial")) return; // header
    const lineNo = idx + 1;
    const [rawSerial, batch, hwRev, rawDate] = line.split(",").map((c) => c.trim());

    const serial = normalizeSerial(rawSerial);
    if (!serial) {
      errors.push(`line ${lineNo}: invalid serial "${rawSerial ?? ""}"`);
      return;
    }

    let manufacturedAt: Date | null = null;
    if (rawDate) {
      const d = new Date(rawDate);
      if (Number.isNaN(d.getTime())) {
        errors.push(`line ${lineNo}: invalid manufactured_at "${rawDate}" (row kept, date dropped)`);
      } else {
        manufacturedAt = d;
      }
    }

    bySerial.set(serial, {
      serial,
      batchCode: batch || null,
      hardwareRevision: hwRev || null,
      manufacturedAt,
    });
  });

  return { rows: [...bySerial.values()], errors };
}

# Factory Registry & Serial-Based Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloud-side factory inventory (`factory_device` registry keyed by eFuse-MAC serial) with CSV import, allocation, zero-touch auto-claim for pre-allocated devices, serial stamping at claim, claim-endpoint hardening — plus a one-line firmware contract addition sending the serial on claim-polls.

**Architecture:** A new `factory_device` table tracks every manufactured unit through `manufactured → allocated → claimed` (+ `rma`/`retired`). The unauthenticated claim-poll endpoint gains a `serial` param: an allocated serial auto-claims one-shot (key delivered and consumed in the same response); a human-claimed device gets its serial stamped at key delivery. Pure decision logic stays in `lib/provisioning.ts` (unit-tested); DB work lives in a new `lib/factory-registry.ts`; a platform-admin-only `/admin/inventory` page handles import/allocation/RMA.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (Neon), vitest, shadcn/ui (radix-nova), `qrcode` npm package (new dep, label reprint), ESP-IDF 5.5 (firmware).

**Spec:** `docs/superpowers/specs/2026-07-09-factory-registry-provisioning-design.md`

## Global Constraints

- TypeScript strict; `@/*` maps to repo root. This Next.js 16 may differ from training data — check `node_modules/next/dist/docs/` before using unfamiliar APIs.
- shadcn style is `radix-nova` — never introduce `base`-color react-aria components (they lack `asChild`).
- Serials are ALWAYS the normalized form: 12 lowercase hex chars, no separators (e.g. `84f703aabbcc`). A serial is NOT a secret and NEVER authenticates by itself.
- Auto-claim fires ONLY on the one-shot `allocated → claimed` registry transition, and ONLY when the allocation includes BOTH an organization AND a store (a store-less claimed device breaks `getDevice`, which resolves devices through stores). A `claimed` serial never re-mints a key (hijack guard).
- Money/none involved. All timestamps `new Date()` per existing schema style.
- Drizzle migration hazard: after `npm run db:generate`, strip the generated SQL to ONLY this feature's changes (snapshot drift emits spurious FK churn).
- Firmware: source ESP-IDF **5.5** (`ESP_IDF_VERSION=5.5.4` breaks esp_wifi_remote SDIO — use major.minor only). Firmware repo: `/Users/eren/Projects/maratus-firmware`, work on branch `feat/factory-serial`.
- Run repo test suite with `npm test` (vitest run); single file: `npx vitest run <path>`.
- Commit after every task; maratus-admin work happens directly on `main` (matches this repo's convention).

---

### Task 1: Pure decision logic — serial normalization, pairing-code validation, auto-claim decision, CSV parser

**Files:**
- Modify: `lib/provisioning.ts` (append; existing `classifyClaimPoll` unchanged)
- Create: `lib/factory-registry-csv.ts`
- Test: `lib/provisioning.test.ts` (append), `lib/factory-registry-csv.test.ts`
- Modify: `docs/superpowers/specs/2026-07-09-factory-registry-provisioning-design.md` (one-sentence amendment)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 3, 4):
  - `normalizeSerial(raw: string | null | undefined): string | null`
  - `isValidPairingCode(code: string): boolean`
  - `type RegistryStatus = "manufactured" | "allocated" | "claimed" | "rma" | "retired"`
  - `shouldAutoClaim(deviceRowExists: boolean, registry: { status: RegistryStatus; allocatedOrganizationId: string | null; allocatedStoreId: string | null } | null): boolean`
  - `parseRegistryCsv(text: string): RegistryCsvResult` with `RegistryCsvRow { serial: string; batchCode: string | null; hardwareRevision: string | null; manufacturedAt: Date | null }` and `RegistryCsvResult { rows: RegistryCsvRow[]; errors: string[] }`

- [ ] **Step 1: Amend the spec (auto-claim requires a store)**

In the spec's "Claim endpoint decision logic" section, extend the hijack-guard paragraph with:

```
Auto-claim additionally requires the allocation to include a store: an
allocation without a store stays on the human-claim path (the admin UI states
this), because a claimed device without a store is invisible to the
store-scoped device queries.
```

- [ ] **Step 2: Write the failing tests (append to `lib/provisioning.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import {
  classifyClaimPoll,
  normalizeSerial,
  isValidPairingCode,
  shouldAutoClaim,
} from "./provisioning";
```

(keep the existing `classifyClaimPoll` describe block; add:)

```ts
describe("normalizeSerial", () => {
  it("lowercases and strips separators", () => {
    expect(normalizeSerial("84:F7:03:AA:BB:CC")).toBe("84f703aabbcc");
    expect(normalizeSerial("84-F7-03-AA-BB-CC")).toBe("84f703aabbcc");
    expect(normalizeSerial("84f703aabbcc")).toBe("84f703aabbcc");
  });
  it("rejects wrong length, non-hex, and empty input", () => {
    expect(normalizeSerial("84f703aabb")).toBeNull();
    expect(normalizeSerial("84f703aabbccdd")).toBeNull();
    expect(normalizeSerial("84f703aabbgg")).toBeNull();
    expect(normalizeSerial("")).toBeNull();
    expect(normalizeSerial(null)).toBeNull();
    expect(normalizeSerial(undefined)).toBeNull();
  });
});

describe("isValidPairingCode", () => {
  it("accepts the firmware XXXX-XXXX shape (32-char unambiguous alphabet)", () => {
    expect(isValidPairingCode("7K3F-9QXM")).toBe(true);
    expect(isValidPairingCode("ABCD-2345")).toBe(true);
  });
  it("rejects ambiguous chars, missing dash, wrong length, lowercase", () => {
    expect(isValidPairingCode("7K3F9QXM")).toBe(false);   // no dash
    expect(isValidPairingCode("7K3F-9QX")).toBe(false);   // short
    expect(isValidPairingCode("7K3F-9QXMM")).toBe(false); // long
    expect(isValidPairingCode("7K3F-9QX0")).toBe(false);  // 0 not in alphabet
    expect(isValidPairingCode("7K3F-9QXI")).toBe(false);  // I not in alphabet
    expect(isValidPairingCode("7k3f-9qxm")).toBe(false);  // lowercase
    expect(isValidPairingCode("")).toBe(false);
  });
});

describe("shouldAutoClaim", () => {
  const allocated = {
    status: "allocated" as const,
    allocatedOrganizationId: "org_1",
    allocatedStoreId: "str_1",
  };
  it("fires only for a fully-allocated serial with no device row", () => {
    expect(shouldAutoClaim(false, allocated)).toBe(true);
  });
  it("never fires when a device row already matches the code", () => {
    expect(shouldAutoClaim(true, allocated)).toBe(false);
  });
  it("never fires without a registry row", () => {
    expect(shouldAutoClaim(false, null)).toBe(false);
  });
  it("never fires for non-allocated statuses (hijack guard)", () => {
    for (const status of ["manufactured", "claimed", "rma", "retired"] as const) {
      expect(shouldAutoClaim(false, { ...allocated, status })).toBe(false);
    }
  });
  it("never fires when the allocation lacks an org or a store", () => {
    expect(shouldAutoClaim(false, { ...allocated, allocatedOrganizationId: null })).toBe(false);
    expect(shouldAutoClaim(false, { ...allocated, allocatedStoreId: null })).toBe(false);
  });
});
```

- [ ] **Step 3: Write the failing CSV tests (`lib/factory-registry-csv.test.ts`)**

```ts
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run lib/provisioning.test.ts lib/factory-registry-csv.test.ts`
Expected: FAIL — `normalizeSerial` not exported / module `./factory-registry-csv` not found.

- [ ] **Step 5: Implement — append to `lib/provisioning.ts`**

```ts
/** Normalize a device serial (eFuse base MAC): strip `:`/`-`/space separators,
 *  lowercase. Valid only as exactly 12 hex chars. */
export function normalizeSerial(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/[:\-\s]/g, "").toLowerCase();
  return /^[0-9a-f]{12}$/.test(s) ? s : null;
}

// Firmware pairing codes: XXXX-XXXX from "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
// (no I, O, 0, 1). Validated server-side before any DB query.
const PAIRING_CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
export function isValidPairingCode(code: string): boolean {
  return PAIRING_CODE_RE.test(code);
}

export type RegistryStatus = "manufactured" | "allocated" | "claimed" | "rma" | "retired";

export interface RegistryAllocationSnapshot {
  status: RegistryStatus;
  allocatedOrganizationId: string | null;
  allocatedStoreId: string | null;
}

/**
 * Auto-claim fires ONLY when no device row matches the polled code AND the
 * serial's registry row is `allocated` with both an org and a store. The serial
 * is public (printed on the box), so nothing else may ever mint a key from it:
 * `claimed` never re-fires (hijack guard), and a store-less allocation stays on
 * the human-claim path (store-less claimed devices are invisible to the
 * store-scoped device queries).
 */
export function shouldAutoClaim(
  deviceRowExists: boolean,
  registry: RegistryAllocationSnapshot | null,
): boolean {
  return (
    !deviceRowExists &&
    registry !== null &&
    registry.status === "allocated" &&
    registry.allocatedOrganizationId !== null &&
    registry.allocatedStoreId !== null
  );
}
```

- [ ] **Step 6: Implement `lib/factory-registry-csv.ts`**

```ts
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
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run lib/provisioning.test.ts lib/factory-registry-csv.test.ts`
Expected: PASS (all new + 3 pre-existing classifyClaimPoll tests).

- [ ] **Step 8: Commit**

```bash
git add lib/provisioning.ts lib/provisioning.test.ts lib/factory-registry-csv.ts lib/factory-registry-csv.test.ts docs/superpowers/specs/2026-07-09-factory-registry-provisioning-design.md
git commit -m "feat(registry): pure serial/pairing-code/auto-claim decision logic + CSV parser"
```

---

### Task 2: Schema, relations, audit constants, migration

**Files:**
- Modify: `lib/db/schema.ts` (device table ~line 230-268; new `factoryDevice` table after `device`)
- Modify: `lib/db/relations.ts`
- Modify: `lib/audit.ts` (~line 50, inside `AUDIT`)
- Modify: `lib/audit-labels.ts` (`AUDIT_LABELS` map)
- Create: `drizzle/0030_<generated-name>.sql` (via `npm run db:generate`, then trimmed)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 3-7):
  - `device.serial: text nullable` + unique index `device_serial_idx`; `device.serialConflict: boolean notNull default false`
  - `factoryDevice` table export (columns exactly as below), `FactoryDeviceRowT = typeof factoryDevice.$inferSelect`
  - `AUDIT.deviceAutoClaimed = "device.auto_claimed"`, `AUDIT.deviceSerialConflict = "device.serial_conflict"`, `AUDIT.registryAllocated = "registry.allocated"`, `AUDIT.registryDeallocated = "registry.deallocated"`

- [ ] **Step 1: Add columns to the `device` table in `lib/db/schema.ts`**

After the `claimedAt` column (line ~257) add:

```ts
    // Normalized eFuse-MAC serial (12 lowercase hex chars), stamped at claim.
    // NOT a credential — matching/inventory only.
    serial: text("serial"),
    // A second physical device tried to claim this serial (unique-index hit);
    // this row's serial stayed null and the admin UI shows a warning.
    serialConflict: boolean("serial_conflict").default(false).notNull(),
```

and to the device table's index list add:

```ts
    uniqueIndex("device_serial_idx").on(t.serial),
```

Ensure `boolean` is imported from `drizzle-orm/pg-core` (add to the existing import if missing).

- [ ] **Step 2: Add the `factoryDevice` table right after the `device` table**

```ts
// Factory inventory: every manufactured unit, keyed by its eFuse-MAC serial.
// Lifecycle: manufactured → allocated → claimed (one-way); rma/retired from any
// state. `allocated` with BOTH org and store arms one-shot auto-claim.
export const factoryDevice = pgTable(
  "factory_device",
  {
    serial: text("serial").primaryKey(), // normalized: 12 lowercase hex chars
    batchCode: text("batch_code"),
    hardwareRevision: text("hardware_revision"),
    status: text("status", {
      enum: ["manufactured", "allocated", "claimed", "rma", "retired"],
    })
      .default("manufactured")
      .notNull(),
    allocatedOrganizationId: text("allocated_organization_id").references(
      () => organization.id,
      { onDelete: "set null" },
    ),
    allocatedStoreId: text("allocated_store_id").references(() => store.id, {
      onDelete: "set null",
    }),
    // Live device row linked at claim.
    deviceId: text("device_id").references(() => device.id, { onDelete: "set null" }),
    // Row auto-created at claim time (serial was never imported).
    unregistered: boolean("unregistered").default(false).notNull(),
    manufacturedAt: timestamp("manufactured_at"),
    importedAt: timestamp("imported_at")
      .$defaultFn(() => new Date())
      .notNull(),
    allocatedAt: timestamp("allocated_at"),
    claimedAt: timestamp("claimed_at"),
    notes: text("notes"),
  },
  (t) => [
    index("factory_device_status_idx").on(t.status),
    index("factory_device_allocated_org_idx").on(t.allocatedOrganizationId),
    index("factory_device_device_id_idx").on(t.deviceId),
  ],
);

export type FactoryDeviceRowT = typeof factoryDevice.$inferSelect;
```

- [ ] **Step 3: Add relations in `lib/db/relations.ts`**

Import `factoryDevice` alongside the existing schema imports, then add (and extend `deviceRelations` with the reverse side):

```ts
export const factoryDeviceRelations = relations(factoryDevice, ({ one }) => ({
  allocatedOrganization: one(organization, {
    fields: [factoryDevice.allocatedOrganizationId],
    references: [organization.id],
  }),
  allocatedStore: one(store, {
    fields: [factoryDevice.allocatedStoreId],
    references: [store.id],
  }),
  device: one(device, {
    fields: [factoryDevice.deviceId],
    references: [device.id],
  }),
}));
```

- [ ] **Step 4: Add audit constants + labels**

In `lib/audit.ts` `AUDIT` object append:

```ts
  deviceAutoClaimed: "device.auto_claimed",
  deviceSerialConflict: "device.serial_conflict",
  registryAllocated: "registry.allocated",
  registryDeallocated: "registry.deallocated",
```

In `lib/audit-labels.ts` `AUDIT_LABELS` append (the completeness guard test fails otherwise):

```ts
  "device.auto_claimed": "Device auto-claimed",
  "device.serial_conflict": "Duplicate device serial detected",
  "registry.allocated": "Inventory allocated",
  "registry.deallocated": "Inventory allocation removed",
```

- [ ] **Step 5: Generate and TRIM the migration**

```bash
npm run db:generate
```

Open the new `drizzle/0030_*.sql` and delete everything except:
- `CREATE TABLE "factory_device" (...)` + its three `CREATE INDEX`es + FK constraints for `factory_device`
- `ALTER TABLE "device" ADD COLUMN "serial" text;`
- `ALTER TABLE "device" ADD COLUMN "serial_conflict" boolean DEFAULT false NOT NULL;`
- `CREATE UNIQUE INDEX "device_serial_idx" ON "device" ("serial");`

Any other statements (spurious FK drops/re-adds on unrelated tables) are snapshot drift — remove them from the SQL only (leave `drizzle/meta/` as generated).

- [ ] **Step 6: Verify — tests + build**

Run: `npm test`
Expected: PASS (audit-labels completeness guard now covers the 4 new constants).
Run: `npm run build`
Expected: compiles clean.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts lib/db/relations.ts lib/audit.ts lib/audit-labels.ts drizzle/
git commit -m "feat(registry): factory_device table, device.serial, audit constants + migration 0030"
```

> Note: do NOT run `npm run db:migrate` against Neon in this task — migration is applied at deploy time (final task checklist).

---

### Task 3: Registry data layer (`lib/factory-registry.ts`)

**Files:**
- Create: `lib/factory-registry.ts`

**Interfaces:**
- Consumes: Task 1 (`RegistryCsvRow`, `shouldAutoClaim` types), Task 2 (schema, `AUDIT` constants), existing `generateDeviceKey`/`id` from `lib/ids.ts`, `recordAudit` from `lib/audit.ts`.
- Produces (used by Tasks 4-6):
  - `importFactoryDevices(rows: RegistryCsvRow[]): Promise<{ imported: number }>`
  - `getFactoryDevices(): Promise<InventoryRow[]>` where `InventoryRow { serial; batchCode; hardwareRevision; status; unregistered; allocatedOrganizationId; allocatedOrgName: string | null; allocatedStoreId; deviceId; deviceName: string | null; manufacturedAt: Date | null; allocatedAt: Date | null; claimedAt: Date | null }`
  - `getRegistryBySerial(serial: string): Promise<RegistryAllocationSnapshot | null>`
  - `allocateSerials(serials: string[], organizationId: string, storeId: string | null): Promise<{ updated: number; error?: string }>`
  - `deallocateSerials(serials: string[]): Promise<{ updated: number }>`
  - `setRegistryStatus(serial: string, status: "rma" | "retired"): Promise<void>`
  - `autoClaimDevice(serial: string, pairingCode: string): Promise<{ deviceKey: string } | null>`
  - `stampDeviceSerial(deviceId: string, organizationId: string, serial: string): Promise<void>`

- [ ] **Step 1: Create `lib/factory-registry.ts`**

```ts
// Factory-inventory data layer: import, allocation, and the claim-side
// serial operations (one-shot auto-claim + serial stamping). Pure decision
// logic lives in lib/provisioning.ts / lib/factory-registry-csv.ts.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import {
  device as deviceTable,
  factoryDevice,
  organization as orgTable,
  store as storeTable,
} from "./db/schema";
import { AUDIT, recordAudit } from "./audit";
import { generateDeviceKey, id } from "./ids";
import type { RegistryAllocationSnapshot } from "./provisioning";
import type { RegistryCsvRow } from "./factory-registry-csv";

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505";
}

/** Idempotent upsert of parsed CSV rows (re-import updates, never duplicates). */
export async function importFactoryDevices(
  rows: RegistryCsvRow[],
): Promise<{ imported: number }> {
  for (const row of rows) {
    await db
      .insert(factoryDevice)
      .values({
        serial: row.serial,
        batchCode: row.batchCode,
        hardwareRevision: row.hardwareRevision,
        manufacturedAt: row.manufacturedAt,
      })
      .onConflictDoUpdate({
        target: factoryDevice.serial,
        set: {
          batchCode: row.batchCode,
          hardwareRevision: row.hardwareRevision,
          manufacturedAt: row.manufacturedAt,
        },
      });
  }
  return { imported: rows.length };
}

export interface InventoryRow {
  serial: string;
  batchCode: string | null;
  hardwareRevision: string | null;
  status: "manufactured" | "allocated" | "claimed" | "rma" | "retired";
  unregistered: boolean;
  allocatedOrganizationId: string | null;
  allocatedOrgName: string | null;
  allocatedStoreId: string | null;
  deviceId: string | null;
  deviceName: string | null;
  manufacturedAt: Date | null;
  allocatedAt: Date | null;
  claimedAt: Date | null;
}

export async function getFactoryDevices(): Promise<InventoryRow[]> {
  return db
    .select({
      serial: factoryDevice.serial,
      batchCode: factoryDevice.batchCode,
      hardwareRevision: factoryDevice.hardwareRevision,
      status: factoryDevice.status,
      unregistered: factoryDevice.unregistered,
      allocatedOrganizationId: factoryDevice.allocatedOrganizationId,
      allocatedOrgName: orgTable.name,
      allocatedStoreId: factoryDevice.allocatedStoreId,
      deviceId: factoryDevice.deviceId,
      deviceName: deviceTable.name,
      manufacturedAt: factoryDevice.manufacturedAt,
      allocatedAt: factoryDevice.allocatedAt,
      claimedAt: factoryDevice.claimedAt,
    })
    .from(factoryDevice)
    .leftJoin(orgTable, eq(factoryDevice.allocatedOrganizationId, orgTable.id))
    .leftJoin(deviceTable, eq(factoryDevice.deviceId, deviceTable.id))
    .orderBy(factoryDevice.serial);
}

export async function getRegistryBySerial(
  serial: string,
): Promise<RegistryAllocationSnapshot | null> {
  const [row] = await db
    .select({
      status: factoryDevice.status,
      allocatedOrganizationId: factoryDevice.allocatedOrganizationId,
      allocatedStoreId: factoryDevice.allocatedStoreId,
    })
    .from(factoryDevice)
    .where(eq(factoryDevice.serial, serial))
    .limit(1);
  return row ?? null;
}

/**
 * Allocate serials to a customer (+ optional store). Only rows still in
 * `manufactured` or `allocated` move; claimed/rma/retired rows are skipped.
 */
export async function allocateSerials(
  serials: string[],
  organizationId: string,
  storeId: string | null,
): Promise<{ updated: number; error?: string }> {
  if (serials.length === 0) return { updated: 0 };
  const [org] = await db
    .select({ id: orgTable.id })
    .from(orgTable)
    .where(eq(orgTable.id, organizationId))
    .limit(1);
  if (!org) return { updated: 0, error: "Customer not found." };
  if (storeId) {
    const [st] = await db
      .select({ organizationId: storeTable.organizationId })
      .from(storeTable)
      .where(eq(storeTable.id, storeId))
      .limit(1);
    if (!st || st.organizationId !== organizationId) {
      return { updated: 0, error: "Store does not belong to this customer." };
    }
  }
  const updated = await db
    .update(factoryDevice)
    .set({
      status: "allocated",
      allocatedOrganizationId: organizationId,
      allocatedStoreId: storeId,
      allocatedAt: new Date(),
    })
    .where(
      and(
        inArray(factoryDevice.serial, serials),
        inArray(factoryDevice.status, ["manufactured", "allocated"]),
      ),
    )
    .returning({ serial: factoryDevice.serial });
  return { updated: updated.length };
}

/** Revert unclaimed allocations back to `manufactured`. */
export async function deallocateSerials(
  serials: string[],
): Promise<{ updated: number }> {
  if (serials.length === 0) return { updated: 0 };
  const updated = await db
    .update(factoryDevice)
    .set({
      status: "manufactured",
      allocatedOrganizationId: null,
      allocatedStoreId: null,
      allocatedAt: null,
    })
    .where(
      and(inArray(factoryDevice.serial, serials), eq(factoryDevice.status, "allocated")),
    )
    .returning({ serial: factoryDevice.serial });
  return { updated: updated.length };
}

export async function setRegistryStatus(
  serial: string,
  status: "rma" | "retired",
): Promise<void> {
  await db.update(factoryDevice).set({ status }).where(eq(factoryDevice.serial, serial));
}

/**
 * One-shot zero-touch claim for a pre-allocated serial. The registry row is
 * claim-locked FIRST (atomic allocated→claimed conditional update) so a racing
 * second poll gets 0 rows and falls back to pending. Returns null (→ caller
 * responds "pending") on any race/collision; per spec the key is delivered and
 * consumed in this same response, so pendingDeviceKey is never persisted.
 */
export async function autoClaimDevice(
  serial: string,
  pairingCode: string,
): Promise<{ deviceKey: string } | null> {
  const [locked] = await db
    .update(factoryDevice)
    .set({ status: "claimed", claimedAt: new Date() })
    .where(and(eq(factoryDevice.serial, serial), eq(factoryDevice.status, "allocated")))
    .returning({
      organizationId: factoryDevice.allocatedOrganizationId,
      storeId: factoryDevice.allocatedStoreId,
    });
  if (!locked) return null;
  if (!locked.organizationId || !locked.storeId) {
    // Incomplete allocation should have been filtered by shouldAutoClaim;
    // release the lock and fall back to the human path.
    await db
      .update(factoryDevice)
      .set({ status: "allocated", claimedAt: null })
      .where(eq(factoryDevice.serial, serial));
    return null;
  }

  const { key, hash } = generateDeviceKey();
  const deviceId = id("dev");
  try {
    await db.insert(deviceTable).values({
      id: deviceId,
      organizationId: locked.organizationId,
      storeId: locked.storeId,
      name: `Printer ${serial.slice(-4)}`,
      status: "offline",
      connectionType: "wifi",
      firmwareVersion: "2.4.1",
      pairingCode, // kept, mirrors claimDevice — the code stays pollable
      serial,
      deviceKeyHash: hash,
      pendingDeviceKey: null, // delivered + consumed in this same response
      claimedAt: new Date(),
      createdAt: new Date(),
    });
  } catch (err) {
    // pairing-code or serial unique collision → release the claim-lock.
    await db
      .update(factoryDevice)
      .set({ status: "allocated", claimedAt: null })
      .where(eq(factoryDevice.serial, serial));
    if (isUniqueViolation(err)) return null;
    throw err;
  }

  await db.update(factoryDevice).set({ deviceId }).where(eq(factoryDevice.serial, serial));
  await recordAudit({
    organizationId: locked.organizationId,
    actor: { type: "system" },
    action: AUDIT.deviceAutoClaimed,
    target: { type: "device", id: deviceId },
    metadata: { serial },
  });
  return { deviceKey: key };
}

/**
 * Stamp a human-claimed device with its serial at key delivery, then link (or
 * self-register) the registry row. A unique-index hit means the same physical
 * serial claimed twice: the new row keeps serial=null, gets serialConflict,
 * and the event is audited — nothing is silently overwritten.
 */
export async function stampDeviceSerial(
  deviceId: string,
  organizationId: string,
  serial: string,
): Promise<void> {
  try {
    const stamped = await db
      .update(deviceTable)
      .set({ serial })
      .where(and(eq(deviceTable.id, deviceId), isNull(deviceTable.serial)))
      .returning({ id: deviceTable.id });
    if (stamped.length === 0) return; // already stamped
  } catch (err) {
    if (isUniqueViolation(err)) {
      await db
        .update(deviceTable)
        .set({ serialConflict: true })
        .where(eq(deviceTable.id, deviceId));
      await recordAudit({
        organizationId,
        actor: { type: "system" },
        action: AUDIT.deviceSerialConflict,
        target: { type: "device", id: deviceId },
        metadata: { serial },
      });
      return;
    }
    throw err;
  }

  const [existing] = await db
    .select({ serial: factoryDevice.serial })
    .from(factoryDevice)
    .where(eq(factoryDevice.serial, serial))
    .limit(1);
  if (existing) {
    await db
      .update(factoryDevice)
      .set({
        status: "claimed",
        deviceId,
        claimedAt: sql`coalesce(${factoryDevice.claimedAt}, now())`,
      })
      .where(eq(factoryDevice.serial, serial));
  } else {
    // Self-registration: serial was never imported (registry works even empty).
    await db.insert(factoryDevice).values({
      serial,
      status: "claimed",
      unregistered: true,
      deviceId,
      claimedAt: new Date(),
    });
  }
}
```

- [ ] **Step 2: Verify — typecheck via build + full test suite**

Run: `npm run build && npm test`
Expected: both clean. (This module is DB-bound; its decision branches were unit-tested in Task 1, and Task 4's route wiring is manually verified at the end.)

- [ ] **Step 3: Commit**

```bash
git add lib/factory-registry.ts
git commit -m "feat(registry): data layer — import, allocation, auto-claim, serial stamping"
```

---

### Task 4: Claim endpoint — validation, IP rate limit, auto-claim, stamping

**Files:**
- Modify: `app/api/device/claim/route.ts` (whole file below)

**Interfaces:**
- Consumes: Task 1 (`isValidPairingCode`, `normalizeSerial`, `shouldAutoClaim`), Task 3 (`getRegistryBySerial`, `autoClaimDevice`, `stampDeviceSerial`).
- Produces: the wire contract `GET /api/device/claim?code=XXXX-XXXX&serial=<12hex>` — unchanged responses (`{status}` / `{status, deviceKey}`), plus 400 on malformed code. Task 8 (firmware) targets this.

- [ ] **Step 1: Replace `app/api/device/claim/route.ts`**

```ts
// GET /api/device/claim?code=<pairing-code>&serial=<efuse-mac> — UNAUTHENTICATED,
// code-gated, rate-limited (per-code AND per-IP). A provisioning device polls
// this until claimed, then receives its device key ONCE.
//   malformed code                    → 400 (validated before any DB hit)
//   no row, serial allocated          → auto-claim: key delivered + consumed NOW
//   no row otherwise                  → { status: "pending" }
//   pendingDeviceKey set              → { status: "claimed", deviceKey },
//                                       then null key + code, stamp serial
//   key already delivered             → { status: "claimed" }
// The serial is public (box label) and NEVER authenticates by itself; auto-claim
// is the one-shot allocated→claimed transition only (hijack guard).

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable } from "@/lib/db/schema";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  classifyClaimPoll,
  isValidPairingCode,
  normalizeSerial,
  shouldAutoClaim,
} from "@/lib/provisioning";
import {
  autoClaimDevice,
  getRegistryBySerial,
  stampDeviceSerial,
} from "@/lib/factory-registry";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim().toUpperCase() ?? "";
  if (!isValidPairingCode(code)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }
  const serial = normalizeSerial(url.searchParams.get("serial"));

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const [ipRl, codeRl] = await Promise.all([
    checkRateLimit(`claim-ip:${ip}`, { limit: 60, windowMs: 60_000 }),
    checkRateLimit(`claim:${code}`, { limit: 30, windowMs: 60_000 }),
  ]);
  if (!ipRl.allowed || !codeRl.allowed) {
    const retryAfterMs = Math.max(ipRl.retryAfterMs, codeRl.retryAfterMs);
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const [device] = await db
    .select({
      id: deviceTable.id,
      pendingDeviceKey: deviceTable.pendingDeviceKey,
      organizationId: deviceTable.organizationId,
    })
    .from(deviceTable)
    .where(eq(deviceTable.pairingCode, code))
    .limit(1);

  // Zero-touch path: pre-allocated serial, no device row for this code yet.
  if (!device && serial) {
    const registry = await getRegistryBySerial(serial);
    if (shouldAutoClaim(false, registry)) {
      const auto = await autoClaimDevice(serial, code);
      if (auto) {
        return NextResponse.json({ status: "claimed", deviceKey: auto.deviceKey });
      }
    }
  }

  const decision = classifyClaimPoll(device ?? null);

  if (decision.consume && device) {
    await db
      .update(deviceTable)
      .set({ pendingDeviceKey: null, pairingCode: null })
      .where(eq(deviceTable.id, device.id));
    if (serial) {
      await stampDeviceSerial(device.id, device.organizationId, serial);
    }
  }

  return NextResponse.json(
    decision.deviceKey
      ? { status: decision.status, deviceKey: decision.deviceKey }
      : { status: decision.status },
  );
}
```

- [ ] **Step 2: Verify — build + tests**

Run: `npm run build && npm test`
Expected: clean. Note the pre-existing contract is preserved: a serial-less poll (old firmware) behaves exactly as before except malformed codes now 400 (they previously did a wasted DB lookup).

- [ ] **Step 3: Commit**

```bash
git add app/api/device/claim/route.ts
git commit -m "feat(registry): claim endpoint — code validation, per-IP limit, auto-claim, serial stamping"
```

---

### Task 5: Platform-admin server actions

**Files:**
- Create: `lib/actions/inventory.ts`

**Interfaces:**
- Consumes: Task 1 (`parseRegistryCsv`, `normalizeSerial`), Task 3 (data layer), existing `requirePlatformAdmin` (`lib/session.ts`), `recordAudit`/`AUDIT`.
- Produces (used by Task 6 UI):
  - `importRegistryCsvAction(csvText: string): Promise<{ ok: boolean; imported: number; errors: string[] }>`
  - `allocateSerialsAction(serials: string[], organizationId: string, storeId: string | null): Promise<{ ok: boolean; updated: number; error?: string }>`
  - `deallocateSerialsAction(serials: string[]): Promise<{ ok: boolean; updated: number }>`
  - `setRegistryStatusAction(serial: string, status: "rma" | "retired"): Promise<{ ok: boolean }>`

- [ ] **Step 1: Create `lib/actions/inventory.ts`**

```ts
"use server";

// Platform-admin actions for the factory-device registry (/admin/inventory).

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/session";
import { parseRegistryCsv } from "@/lib/factory-registry-csv";
import {
  allocateSerials,
  deallocateSerials,
  importFactoryDevices,
  setRegistryStatus,
} from "@/lib/factory-registry";
import { AUDIT, recordAudit } from "@/lib/audit";

const MAX_CSV_BYTES = 2 * 1024 * 1024; // ~10k rows is well under 2 MB

export async function importRegistryCsvAction(
  csvText: string,
): Promise<{ ok: boolean; imported: number; errors: string[] }> {
  await requirePlatformAdmin();
  if (csvText.length > MAX_CSV_BYTES) {
    return { ok: false, imported: 0, errors: ["File too large (max 2 MB)."] };
  }
  const { rows, errors } = parseRegistryCsv(csvText);
  if (rows.length === 0) {
    return { ok: false, imported: 0, errors: errors.length ? errors : ["No valid rows found."] };
  }
  const { imported } = await importFactoryDevices(rows);
  revalidatePath("/admin/inventory");
  return { ok: true, imported, errors };
}

export async function allocateSerialsAction(
  serials: string[],
  organizationId: string,
  storeId: string | null,
): Promise<{ ok: boolean; updated: number; error?: string }> {
  const ctx = await requirePlatformAdmin();
  const result = await allocateSerials(serials, organizationId, storeId);
  if (result.error) return { ok: false, updated: 0, error: result.error };
  if (result.updated > 0) {
    await recordAudit({
      organizationId,
      actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
      action: AUDIT.registryAllocated,
      target: { type: "registry", id: serials.join(",") },
      metadata: { count: result.updated, storeId },
    });
  }
  revalidatePath("/admin/inventory");
  return { ok: true, updated: result.updated };
}

export async function deallocateSerialsAction(
  serials: string[],
): Promise<{ ok: boolean; updated: number }> {
  await requirePlatformAdmin();
  const result = await deallocateSerials(serials);
  revalidatePath("/admin/inventory");
  return { ok: true, updated: result.updated };
}

export async function setRegistryStatusAction(
  serial: string,
  status: "rma" | "retired",
): Promise<{ ok: boolean }> {
  await requirePlatformAdmin();
  await setRegistryStatus(serial, status);
  revalidatePath("/admin/inventory");
  return { ok: true };
}
```

> `deallocateSerialsAction` intentionally skips `recordAudit`: the rows lose their org reference at deallocation and `recordAudit` requires an `organizationId`. `AUDIT.registryDeallocated` stays available for a follow-up that snapshots the org first — if the reviewer prefers, fetch the previous `allocatedOrganizationId` per serial before deallocating and audit per-org; keep it simple otherwise.

- [ ] **Step 2: Verify — build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/inventory.ts
git commit -m "feat(registry): platform-admin inventory actions (import/allocate/deallocate/status)"
```

---

### Task 6: `/admin/inventory` page, table component, nav item

**Files:**
- Create: `app/(admin)/admin/inventory/page.tsx`
- Create: `components/inventory/inventory-table.tsx` (client)
- Modify: `lib/nav.ts` (ADMIN_NAV)
- Modify: `package.json` (add `qrcode` + `@types/qrcode`)

**Interfaces:**
- Consumes: Task 3 (`getFactoryDevices`, `InventoryRow`), Task 5 actions, existing `getTenants` (`lib/data.ts`), `PageHeader`/`KpiCard`, shadcn `table`/`dialog`/`select`/`badge`/`button`/`input`/`dropdown-menu`, `sonner` toasts.
- Produces: the page itself; no downstream consumers.

- [ ] **Step 1: Install the QR dependency**

```bash
npm install qrcode && npm install -D @types/qrcode
```

- [ ] **Step 2: Add the nav item in `lib/nav.ts`**

Add `Boxes` to the lucide import list, and in `ADMIN_NAV` insert after "Device Fleet":

```ts
  { label: "Inventory", href: "/admin/inventory", icon: Boxes },
```

- [ ] **Step 3: Create `app/(admin)/admin/inventory/page.tsx`**

The layout group already gates platform-admin access; the page follows the fleet-page pattern (fragment + PageHeader + KPI grid + table). Stores are fetched flat and grouped client-side in the allocate dialog.

```tsx
import { Boxes } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { InventoryTable } from "@/components/inventory/inventory-table";
import { getFactoryDevices } from "@/lib/factory-registry";
import { getTenants } from "@/lib/data";
import { db } from "@/lib/db";
import { store } from "@/lib/db/schema";

export default async function InventoryPage() {
  const rows = await getFactoryDevices();
  const customers = (await getTenants()).map((t) => ({ id: t.id, name: t.name }));
  const stores = await db
    .select({ id: store.id, name: store.name, organizationId: store.organizationId })
    .from(store);

  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Every manufactured device, from factory floor to claim."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total serials" value={String(rows.length)} icon={Boxes} />
        <KpiCard label="Manufactured" value={String(count("manufactured"))} hint="in stock" />
        <KpiCard label="Allocated" value={String(count("allocated"))} hint="awaiting install" />
        <KpiCard label="Claimed" value={String(count("claimed"))} hint="live in the field" />
      </div>

      <InventoryTable rows={rows} customers={customers} stores={stores} />
    </>
  );
}
```

- [ ] **Step 4: Create `components/inventory/inventory-table.tsx`**

One client component holding the import card, filters, table, allocate dialog, and QR dialog. Serialize `Date`s via `toLocaleDateString()` on render (rows arrive as RSC-serialized props).

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { MoreHorizontal, QrCode, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { InventoryRow } from "@/lib/factory-registry";
import {
  allocateSerialsAction, deallocateSerialsAction,
  importRegistryCsvAction, setRegistryStatusAction,
} from "@/lib/actions/inventory";

const STATUS_VARIANT: Record<InventoryRow["status"], "default" | "secondary" | "outline" | "destructive"> = {
  manufactured: "outline",
  allocated: "secondary",
  claimed: "default",
  rma: "destructive",
  retired: "destructive",
};

interface Customer { id: string; name: string }
interface StoreOption { id: string; name: string; organizationId: string }

export function InventoryTable({
  rows, customers, stores,
}: {
  rows: InventoryRow[];
  customers: Customer[];
  stores: StoreOption[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [batchFilter, setBatchFilter] = useState("");
  const [busy, setBusy] = useState(false);

  // Allocate dialog state
  const [allocating, setAllocating] = useState<string | null>(null); // serial
  const [allocOrg, setAllocOrg] = useState<string>("");
  const [allocStore, setAllocStore] = useState<string>("none");

  // QR dialog state
  const [qrSerial, setQrSerial] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (statusFilter === "all" || r.status === statusFilter) &&
          (!batchFilter || (r.batchCode ?? "").toLowerCase().includes(batchFilter.toLowerCase())),
      ),
    [rows, statusFilter, batchFilter],
  );

  async function onImportFile(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const result = await importRegistryCsvAction(text);
      if (result.ok) {
        toast.success(`Imported ${result.imported} serial${result.imported === 1 ? "" : "s"}.`);
        result.errors.forEach((e) => toast.warning(e));
      } else {
        result.errors.forEach((e) => toast.error(e));
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onAllocate() {
    if (!allocating || !allocOrg) return;
    setBusy(true);
    try {
      const result = await allocateSerialsAction(
        [allocating], allocOrg, allocStore === "none" ? null : allocStore,
      );
      if (result.ok) toast.success(`Allocated ${result.updated} serial.`);
      else toast.error(result.error ?? "Allocation failed.");
    } finally {
      setBusy(false);
      setAllocating(null);
      setAllocOrg("");
      setAllocStore("none");
    }
  }

  async function onShowQr(serial: string) {
    setQrSerial(serial);
    setQrDataUrl(await QRCode.toDataURL(serial, { width: 240, margin: 1 }));
  }

  const orgStores = stores.filter((s) => s.organizationId === allocOrg);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import from factory CSV</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onImportFile(e.target.files[0])}
          />
          <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Choose CSV…
          </Button>
          <span className="text-muted-foreground">
            Columns: <code>serial,batch,hw_rev,manufactured_at</code> — serial required, re-import updates in place.
          </span>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="manufactured">Manufactured</SelectItem>
            <SelectItem value="allocated">Allocated</SelectItem>
            <SelectItem value="claimed">Claimed</SelectItem>
            <SelectItem value="rma">RMA</SelectItem>
            <SelectItem value="retired">Retired</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Filter by batch…"
          value={batchFilter}
          onChange={(e) => setBatchFilter(e.target.value)}
          className="w-48"
        />
        <span className="text-sm text-muted-foreground">{filtered.length} of {rows.length}</span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Serial</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Device</TableHead>
            <TableHead>Manufactured</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => (
            <TableRow key={r.serial}>
              <TableCell className="font-mono text-xs">{r.serial}</TableCell>
              <TableCell>{r.batchCode ?? "—"}</TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5">
                  <Badge variant={STATUS_VARIANT[r.status]} className="capitalize">{r.status}</Badge>
                  {r.unregistered && <Badge variant="destructive">unregistered</Badge>}
                </span>
              </TableCell>
              <TableCell>
                {r.allocatedOrganizationId ? (
                  <Link href={`/admin/customers/${r.allocatedOrganizationId}`} className="underline">
                    {r.allocatedOrgName}
                  </Link>
                ) : "—"}
              </TableCell>
              <TableCell>
                {r.deviceId ? (
                  <Link href={`/admin/devices/${r.deviceId}`} className="underline">
                    {r.deviceName ?? r.deviceId}
                  </Link>
                ) : "—"}
              </TableCell>
              <TableCell>{r.manufacturedAt ? new Date(r.manufacturedAt).toLocaleDateString() : "—"}</TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(r.status === "manufactured" || r.status === "allocated") && (
                      <DropdownMenuItem onSelect={() => { setAllocating(r.serial); setAllocOrg(r.allocatedOrganizationId ?? ""); }}>
                        Allocate to customer…
                      </DropdownMenuItem>
                    )}
                    {r.status === "allocated" && (
                      <DropdownMenuItem
                        onSelect={async () => {
                          const res = await deallocateSerialsAction([r.serial]);
                          if (res.ok) toast.success("Allocation removed.");
                        }}
                      >
                        Remove allocation
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => onShowQr(r.serial)}>
                      <QrCode className="size-4" /> Show label QR
                    </DropdownMenuItem>
                    {r.status !== "rma" && (
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={async () => {
                          const res = await setRegistryStatusAction(r.serial, "rma");
                          if (res.ok) toast.success("Marked as RMA.");
                        }}
                      >
                        Mark as RMA
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                No serials match. Import a factory CSV to get started.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={allocating !== null} onOpenChange={(o) => !o && setAllocating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allocate {allocating}</DialogTitle>
            <DialogDescription>
              Zero-touch auto-claim requires BOTH a customer and a store. Without a
              store the device stays on the normal pairing-code claim path.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={allocOrg} onValueChange={(v) => { setAllocOrg(v); setAllocStore("none"); }}>
              <SelectTrigger><SelectValue placeholder="Customer…" /></SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={allocStore} onValueChange={setAllocStore} disabled={!allocOrg}>
              <SelectTrigger><SelectValue placeholder="Store (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No store — manual claim</SelectItem>
                {orgStores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAllocating(null)}>Cancel</Button>
            <Button disabled={!allocOrg || busy} onClick={onAllocate}>Allocate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={qrSerial !== null} onOpenChange={(o) => !o && setQrSerial(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{qrSerial}</DialogTitle>
            <DialogDescription>Label QR — encodes the bare serial string.</DialogDescription>
          </DialogHeader>
          {qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt={`QR for ${qrSerial}`} className="mx-auto rounded bg-white p-2" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

> Adapt to the repo's actual shadcn exports if a named import differs (check the corresponding `components/ui/*.tsx` before writing) — e.g. `DropdownMenuItem` `variant` prop exists in radix-nova; if not, drop the prop. Playwright QA note: radix-nova controls need native `.click()` via `browser_evaluate`.

- [ ] **Step 5: Verify — build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 6: Manual smoke (dev server)**

Run `npm run dev`, sign in as `admin@maratus.app` / `123456`, open `/admin/inventory`:
- Import a 3-line CSV (one bad serial) → toast shows 2 imported + 1 warning.
- Allocate a serial to Roastwell Coffee + a store → status badge flips to "allocated".
- Show label QR renders. Mark as RMA works.

- [ ] **Step 7: Commit**

```bash
git add app/\(admin\)/admin/inventory components/inventory lib/nav.ts package.json package-lock.json
git commit -m "feat(registry): /admin/inventory — CSV import, allocation, RMA, label QR"
```

---

### Task 7: Serial + registry badges on the admin device detail page

**Files:**
- Modify: `app/(admin)/admin/devices/[deviceId]/page.tsx`

**Interfaces:**
- Consumes: Task 2 schema (`device.serial`, `device.serialConflict`, `factoryDevice.unregistered`).
- Produces: UI only.

- [ ] **Step 1: Query serial fields directly on the page**

The page already queries `db` directly for `firmwareRelease` (line ~32); add alongside it:

```ts
import { device as deviceTable, factoryDevice, firmwareRelease } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
// ...
const [serialInfo] = await db
  .select({
    serial: deviceTable.serial,
    serialConflict: deviceTable.serialConflict,
    unregistered: factoryDevice.unregistered,
  })
  .from(deviceTable)
  .leftJoin(factoryDevice, eq(factoryDevice.deviceId, deviceTable.id))
  .where(eq(deviceTable.id, device.id))
  .limit(1);
```

- [ ] **Step 2: Add a Serial row to the `specs` array**

Import `Tag` from lucide-react and append to `specs`:

```ts
{ icon: Tag, label: "Serial", value: serialInfo?.serial ?? "—", mono: true },
```

- [ ] **Step 3: Add warning badges under "Status & management"**

Import `Badge` from `@/components/ui/badge`; inside the Status & management `CardContent`, after the "Last seen" row:

```tsx
{serialInfo?.serialConflict && (
  <Badge variant="destructive" className="w-full justify-center">
    Duplicate serial detected — this row's serial was left unset
  </Badge>
)}
{serialInfo?.unregistered && (
  <Badge variant="outline" className="w-full justify-center">
    Not in factory registry
  </Badge>
)}
```

- [ ] **Step 4: Verify — build, then commit**

Run: `npm run build`
Expected: clean.

```bash
git add app/\(admin\)/admin/devices/\[deviceId\]/page.tsx
git commit -m "feat(registry): serial + registry badges on admin device detail"
```

---

### Task 8: Firmware — send the serial on claim-polls

**Files (in `/Users/eren/Projects/maratus-firmware`, branch `feat/factory-serial`):**
- Modify: `components/cloud/cloud.c` (`cloud_claim_poll`, ~line 69)

**Interfaces:**
- Consumes: Task 4's wire contract (`&serial=<12hex>` query param; server ignores absent/invalid serials).
- Produces: nothing downstream.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/eren/Projects/maratus-firmware && git checkout -b feat/factory-serial
```

- [ ] **Step 2: Add the serial to the claim URL in `components/cloud/cloud.c`**

Add `#include "esp_mac.h"` to the includes, then a file-local helper above `cloud_claim_poll`:

```c
// The registry serial is the P4's own eFuse base MAC — the same MAC esptool
// prints during factory flashing. Do NOT use esp_wifi_get_mac()/ESP_MAC_WIFI_STA:
// that is the C6 radio module's MAC, which differs from the P4's and changes if
// the radio module is ever swapped.
static void serial_from_efuse(char out[13])
{
    uint8_t mac[6] = {0};
    out[0] = '\0';
    if (esp_efuse_mac_get_default(mac) == ESP_OK) {
        snprintf(out, 13, "%02x%02x%02x%02x%02x%02x",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    }
}
```

In `cloud_claim_poll`, replace the URL snprintf:

```c
    char serial[13];
    serial_from_efuse(serial);
    char url[256];
    snprintf(url, sizeof(url), "%s/api/device/claim?code=%s&serial=%s",
             appcfg_base_url(), code, serial);
```

(An empty serial yields `&serial=` — the server's `normalizeSerial` treats it as absent.)

- [ ] **Step 3: Build**

```bash
source ~/esp/esp-idf-5.5/export.sh   # IDF 5.5 — NOT 5.5.4 (SDIO trap)
idf.py build
```

Expected: clean build. (No host-test harness covers `cloud.c`; HIL verification is the deferred step, as with prior cloud-contract changes.)

- [ ] **Step 4: Commit**

```bash
git add components/cloud/cloud.c
git commit -m "feat(cloud): send eFuse-MAC serial on claim-polls (factory registry)"
```

Merging `feat/factory-serial` to firmware main waits for the cloud side to be deployed (server ignores the param until then, so order is actually flexible — but keep the branch until HIL).

---

### Task 9: Final verification & ship checklist

**Files:** none new.

- [ ] **Step 1: Full admin-repo verification**

```bash
cd /Users/eren/Projects/maratus-admin && npm run build && npm test && npm run lint
```

Expected: all clean.

- [ ] **Step 2: End-to-end manual QA (dev, seeded DB)**

1. `npm run db:migrate` against the DEV database only.
2. Import a CSV with 3 serials; allocate one to Roastwell + store.
3. Simulate the device: `curl "http://localhost:3000/api/device/claim?code=ABCD-2345&serial=<allocated>"` → expect `{"status":"claimed","deviceKey":"dvk_..."}`. Repeat the exact same call → expect `{"status":"claimed"}` WITHOUT a key (the code now matches the created device row and the key was consumed on delivery; `pending` here would be a bug). Registry row shows claimed + linked device; device visible in fleet with name `Printer <last4>`.
4. Human path: claim a seeded unclaimed device from the tenant panel, then poll with `&serial=<unimported>` → key delivered once, device gets the serial, registry gains an `unregistered` row.
5. Malformed code: `curl ".../api/device/claim?code=bad"` → 400.
6. Hijack guard: re-poll the auto-claimed serial with a DIFFERENT valid code → `{"status":"pending"}` and NO new device row.

- [ ] **Step 3: Ship**

```bash
git push origin main
```

Then production: `npm run db:migrate` against Neon (migration 0030 — do not repeat the 0028 not-applied hazard), deploy via Vercel, and re-run QA step 3's curl against prod with a test org. Firmware branch merges after HIL.

---

## Self-review notes (already applied)

- **Spec coverage:** identity/normalization (T1), table+serial column (T2), three population doors (T3+T5+T6, self-registration in `stampDeviceSerial`), firmware param (T8), decision table + hijack guard + duplicate-serial (T1/T3/T4), admin UI incl. QR reprint + badges (T6/T7), hardening: IP limit + format validation (T4), entropy audit (spec-only, no code), naming `Printer <last4>` (T3), out-of-scope items untouched.
- **Spec deviation (amended in T1 Step 1):** auto-claim additionally requires a store, because `getDevice`/tenant views resolve devices through stores — a store-less claimed device would 404 in admin detail.
- **`registryDeallocated` audit constant** is defined but unused by the simple path (documented in T5); acceptable — the labels guard only checks constants have labels.
- **Type consistency check:** `RegistryAllocationSnapshot` produced in T1, consumed in T3/T4; `InventoryRow` produced in T3, consumed in T6; `RegistryCsvRow` produced in T1, consumed in T3/T5. Action signatures in T5 match T6's call sites.

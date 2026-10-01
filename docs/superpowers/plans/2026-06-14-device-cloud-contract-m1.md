# Device Cloud Contract (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the cloud-side contract the Maratus firmware will target — unified transaction model (two sources), receipt metadata on ingest, a device config-delivery endpoint with ETag caching, and a `config-changed` command that nudges devices when branding changes.

**Architecture:** All work lands in `maratus-admin`. Pure, testable logic goes in `lib/*.ts` with vitest unit tests (the established pattern — route handlers stay thin and uncovered). The existing `receipt` row *is* the transaction; we add a `source` discriminator and nullable `deviceId` so a future cloud-ingested path converges on the same model. Device display config (the existing v3 `PrinterConfig` in `tenant_settings`) is served over a new authenticated GET endpoint with a stable ETag so devices cache it and re-pull only on change.

**Tech Stack:** Next.js 16 App Router (route handlers), Drizzle ORM over Neon, vitest, Node `crypto` for the config hash. Spec: `docs/superpowers/specs/2026-06-14-device-architecture-design.md`.

**Planning notes (deviations from spec, intentional):**
- Spec §4.5 says "ensure `/api/v1/receipts` writes `source:'cloud'`." That route is **GET-only** today — there is no cloud-ingest POST. Per the spec's own "cloud-ingested = stub/deferred," M1 delivers only **schema readiness** (`source` default + nullable `deviceId`). No POST endpoint is built. The cloud-ingest endpoint is a later spec.
- `deviceCommand.type` uses Drizzle `text({ enum })`, which is **TypeScript-only** (no DB enum/CHECK). Adding `config-changed` therefore needs **no migration** — only the `COMMAND_TYPES` constant. The only DB migration in M1 is the `receipt` table change (Task 1).

---

### Task 1: Receipt schema — `source`, `metadata`, nullable `deviceId`

**Files:**
- Modify: `lib/db/schema.ts` (receipt table, ~line 333–370)
- Modify: `lib/api/serialize.ts:11` and `:33` (nullable deviceId ripple)
- Create: migration via `npm run db:generate`

- [ ] **Step 1: Make `deviceId` nullable and add `source` + `metadata` columns**

In `lib/db/schema.ts`, in the `receipt` table, change the `deviceId` column from `.notNull()` to nullable and add two columns. Replace:

```ts
    deviceId: text("device_id")
      .notNull()
      .references(() => device.id, { onDelete: "cascade" }),
```

with:

```ts
    // Nullable: device-ingested receipts set this; cloud-ingested receipts (source="cloud") leave it null.
    deviceId: text("device_id").references(() => device.id, {
      onDelete: "cascade",
    }),
    // Ingestion source. "device" = rendered + uploaded by a printer; "cloud" = created via partner API.
    source: text("source", { enum: ["device", "cloud"] })
      .default("device")
      .notNull(),
    // Technical render metadata ONLY (no parsed receipt semantics). Shape: ReceiptMetadata in lib/ingest-metadata.ts.
    metadata: jsonb("metadata"),
```

(`jsonb` is already imported in this file — it is used by `tenantSettings.printerScreens`.)

- [ ] **Step 2: Update the API serializers for nullable deviceId**

In `lib/api/serialize.ts`, change both interface fields from `deviceId: string;` to `deviceId: string | null;` (line 11 in `ApiReceiptRow`, line 33 in `ApiReceiptDetail`). The serializer bodies already pass `r.deviceId` / `d.deviceId` straight through to `device_id`, so no body change is needed.

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new SQL file under `drizzle/` (or the configured migrations dir) containing an `ALTER TABLE "receipt" ALTER COLUMN "device_id" DROP NOT NULL`, plus `ADD COLUMN "source" text ... DEFAULT 'device' NOT NULL` and `ADD COLUMN "metadata" jsonb`. It should NOT mention `device_command` (the enum change is TS-only).

- [ ] **Step 4: Typecheck — verify the nullable ripple is fully handled**

Run: `npx tsc --noEmit`
Expected: PASS. (The two serializer interfaces were the only `string`-typed consumers; data-layer selects pass the DB value through unchanged.)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS (all existing tests green; no schema test exists yet).

- [ ] **Step 6: Apply the migration locally**

Run: `npm run db:migrate`
Expected: migration applies cleanly with no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts lib/api/serialize.ts drizzle/
git commit -m "feat(schema): unified transaction model — receipt source + metadata, nullable deviceId"
```

---

### Task 2: `parseReceiptMetadata` — pure metadata sanitizer

**Files:**
- Create: `lib/ingest-metadata.ts`
- Test: `lib/ingest-metadata.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ingest-metadata.test.ts
import { describe, it, expect } from "vitest";
import { parseReceiptMetadata } from "./ingest-metadata";

describe("parseReceiptMetadata", () => {
  it("returns null for non-objects and empty input", () => {
    expect(parseReceiptMetadata(null)).toBeNull();
    expect(parseReceiptMetadata("nope")).toBeNull();
    expect(parseReceiptMetadata({})).toBeNull();
    expect(parseReceiptMetadata({ junk: 1 })).toBeNull();
  });

  it("keeps and coerces valid technical fields", () => {
    const m = parseReceiptMetadata({
      renderWidth: 576,
      renderHeight: 1840,
      contentHash: "a1b2c3",
      firmwareVersion: "2.4.1",
      renderMs: 312,
    });
    expect(m).toEqual({
      renderWidth: 576,
      renderHeight: 1840,
      contentHash: "a1b2c3",
      firmwareVersion: "2.4.1",
      renderMs: 312,
    });
  });

  it("clamps out-of-range numbers and drops invalid ones", () => {
    const m = parseReceiptMetadata({ renderWidth: 0, renderHeight: 99999, renderMs: -5 });
    expect(m).toEqual({ renderHeight: 10000 }); // width 0 dropped, height clamped, negative ms dropped
  });

  it("truncates over-long strings and ignores non-strings", () => {
    const m = parseReceiptMetadata({ contentHash: "x".repeat(100), firmwareVersion: 123 });
    expect(m).toEqual({ contentHash: "x".repeat(64) });
  });

  it("ignores unknown keys", () => {
    expect(parseReceiptMetadata({ total: 4200, renderWidth: 384 })).toEqual({ renderWidth: 384 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ingest-metadata.test.ts`
Expected: FAIL — `Failed to resolve import "./ingest-metadata"`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ingest-metadata.ts
// Pure: sanitize the OPTIONAL technical render metadata a device sends with a receipt.
// Holds NO parsed receipt semantics (no totals, no line items) — only render facts.

export interface ReceiptMetadata {
  renderWidth?: number;
  renderHeight?: number;
  contentHash?: string;
  firmwareVersion?: string;
  renderMs?: number;
}

function intIn(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  if (n < min) return undefined; // below floor → drop (not a meaningful value)
  return n > max ? max : n; // above ceiling → clamp
}

function str(v: unknown, maxLen: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export function parseReceiptMetadata(raw: unknown): ReceiptMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: ReceiptMetadata = {};

  const w = intIn(r.renderWidth, 1, 10000);
  if (w !== undefined) out.renderWidth = w;
  const h = intIn(r.renderHeight, 1, 10000);
  if (h !== undefined) out.renderHeight = h;
  const ms = intIn(r.renderMs, 0, 600000);
  if (ms !== undefined) out.renderMs = ms;
  const hash = str(r.contentHash, 64);
  if (hash !== undefined) out.contentHash = hash;
  const fw = str(r.firmwareVersion, 32);
  if (fw !== undefined) out.firmwareVersion = fw;

  return Object.keys(out).length === 0 ? null : out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ingest-metadata.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ingest-metadata.ts lib/ingest-metadata.test.ts
git commit -m "feat(ingest): pure receipt render-metadata sanitizer"
```

---

### Task 3: Wire `metadata` + `source` into `POST /api/ingest`

**Files:**
- Modify: `app/api/ingest/route.ts` (body parsing block ~line 76–105; insert block ~line 121–133)

- [ ] **Step 1: Import the sanitizer**

At the top of `app/api/ingest/route.ts`, add alongside the existing imports:

```ts
import { parseReceiptMetadata, type ReceiptMetadata } from "@/lib/ingest-metadata";
```

- [ ] **Step 2: Parse metadata from both body formats**

In the body-reading block, declare a metadata holder next to `bodyDeviceId` and populate it in each branch.

Add near the other `let` declarations (after `let bodyDeviceId: string | undefined;`):

```ts
  let metadata: ReceiptMetadata | null = null;
```

In the `multipart/form-data` branch, after `bodyDeviceId = (form.get("deviceId") as string | null) ?? undefined;` add:

```ts
      const metaRaw = form.get("metadata");
      if (typeof metaRaw === "string" && metaRaw) {
        try { metadata = parseReceiptMetadata(JSON.parse(metaRaw)); } catch { metadata = null; }
      }
```

In the JSON branch, extend the destructured type with `metadata?: unknown;` and after `bodyDeviceId = json.deviceId;` add:

```ts
      metadata = parseReceiptMetadata(json.metadata);
```

- [ ] **Step 3: Persist `source` + `metadata` on insert**

In the `db.insert(receiptTable).values({ ... })` call, add two fields alongside the existing ones:

```ts
    source: "device",
    metadata,
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS. (`metadata` is `ReceiptMetadata | null`, matching the nullable `jsonb` column.)

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: PASS (ingest-validation + metadata tests green; route behavior for legacy callers unchanged since metadata is optional).

- [ ] **Step 6: Commit**

```bash
git add app/api/ingest/route.ts
git commit -m "feat(ingest): persist source=device + optional render metadata"
```

---

### Task 4: Add `config-changed` command type

**Files:**
- Modify: `lib/device-commands.ts:4`
- Test: `lib/device-commands.test.ts` (existing — extend)

- [ ] **Step 1: Write the failing test**

In `lib/device-commands.test.ts`, add a case inside the existing `describe`:

```ts
  it("accepts config-changed", () => {
    expect(isValidCommandType("config-changed")).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/device-commands.test.ts`
Expected: FAIL — `expected false to be true`.

- [ ] **Step 3: Add the type**

In `lib/device-commands.ts`, change line 4:

```ts
export const COMMAND_TYPES = ["reboot", "refresh", "identify", "config-changed"] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/device-commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the schema enum to match (TS-only, no migration)**

In `lib/db/schema.ts`, in the `deviceCommand` table, update the `type` column enum to include the new value:

```ts
    type: text("type", { enum: ["reboot", "refresh", "identify", "config-changed"] }).notNull(),
```

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/device-commands.ts lib/device-commands.test.ts lib/db/schema.ts
git commit -m "feat(device): add config-changed command type"
```

---

### Task 5: `computeConfigVersion` + `etagMatches` — pure ETag helpers

**Files:**
- Create: `lib/device-config.ts`
- Test: `lib/device-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/device-config.test.ts
import { describe, it, expect } from "vitest";
import { computeConfigVersion, etagMatches, type ConfigVersionInput } from "./device-config";

const base: ConfigVersionInput = {
  printerScreens: { version: 3, foo: "bar" },
  printerLayout: null,
  logoUrl: "receipts/org/logo.png",
  brandColor: "#10A765",
  brandBg: null,
  brandFg: null,
  brandMuted: null,
};

describe("computeConfigVersion", () => {
  it("is a stable hex string for identical input", () => {
    const a = computeConfigVersion(base);
    const b = computeConfigVersion({ ...base });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]+$/);
  });

  it("changes when any renderable input changes", () => {
    const v = computeConfigVersion(base);
    expect(computeConfigVersion({ ...base, brandColor: "#000000" })).not.toBe(v);
    expect(computeConfigVersion({ ...base, logoUrl: null })).not.toBe(v);
    expect(computeConfigVersion({ ...base, printerScreens: { version: 3, foo: "baz" } })).not.toBe(v);
  });
});

describe("etagMatches", () => {
  it("matches quoted, weak, and bare forms", () => {
    expect(etagMatches('"abc"', "abc")).toBe(true);
    expect(etagMatches('W/"abc"', "abc")).toBe(true);
    expect(etagMatches("abc", "abc")).toBe(true);
  });
  it("does not match different or missing tags", () => {
    expect(etagMatches('"xyz"', "abc")).toBe(false);
    expect(etagMatches(null, "abc")).toBe(false);
    expect(etagMatches(undefined, "abc")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/device-config.test.ts`
Expected: FAIL — `Failed to resolve import "./device-config"`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/device-config.ts
// Pure: derive a stable ETag for a device's display config from its RENDERABLE inputs.
// Presigned URLs rotate every request, so they are deliberately excluded — only the
// stored config + brand tokens + logo KEY participate, keeping the ETag stable until
// the merchant actually changes branding.

import { createHash } from "node:crypto";

export interface ConfigVersionInput {
  printerScreens: unknown;
  printerLayout: unknown;
  logoUrl: string | null; // R2 object KEY (not a presigned URL)
  brandColor: string | null;
  brandBg: string | null;
  brandFg: string | null;
  brandMuted: string | null;
}

export function computeConfigVersion(input: ConfigVersionInput): string {
  const canonical = JSON.stringify([
    input.printerScreens ?? null,
    input.printerLayout ?? null,
    input.logoUrl ?? null,
    input.brandColor ?? null,
    input.brandBg ?? null,
    input.brandFg ?? null,
    input.brandMuted ?? null,
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/** True if an incoming If-None-Match header matches `version` (handles quotes + W/ prefix). */
export function etagMatches(ifNoneMatch: string | null | undefined, version: string): boolean {
  if (!ifNoneMatch) return false;
  const cleaned = ifNoneMatch.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  return cleaned === version;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/device-config.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/device-config.ts lib/device-config.test.ts
git commit -m "feat(device): stable config ETag helpers"
```

---

### Task 6: `getDeviceConfig` data function

**Files:**
- Modify: `lib/data.ts` (add after `getTenantBranding`, ~line 829)

- [ ] **Step 1: Add imports if missing**

`lib/data.ts` already imports `normalizePrinterConfig`, `PRINTER_SCREENS`, `presignedGetUrl`, and `resolveBrandTokens` (used by `getTenantBranding`). Add the new helper import at the top alongside the existing printer-layout import:

```ts
import { computeConfigVersion } from "@/lib/device-config";
```

- [ ] **Step 2: Add the function**

Append after `getTenantBranding` (around line 829):

```ts
/** Payload served to a device over GET /api/device/config (icons + logo presigned). */
export interface DeviceConfigPayload {
  version: string;
  brandColor: string;
  brandBg: string;
  brandFg: string;
  brandMuted: string;
  logoUrl: string | null; // presigned, short-lived
  config: PrinterConfig; // uploaded icon keys presigned for rendering
}

/**
 * Resolve a device's display config + a stable version/ETag. Computes the version
 * from STORED inputs first so an If-None-Match hit can short-circuit (304) BEFORE
 * doing any presigning work.
 */
export async function getDeviceConfig(
  organizationId: string,
  ifNoneMatch?: string | null,
): Promise<{ version: string; notModified: boolean; payload: DeviceConfigPayload | null }> {
  const [s] = await db
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.organizationId, organizationId))
    .limit(1);

  const version = computeConfigVersion({
    printerScreens: s?.printerScreens ?? null,
    printerLayout: s?.printerLayout ?? null,
    logoUrl: s?.logoUrl ?? null,
    brandColor: s?.brandColor ?? null,
    brandBg: s?.brandBg ?? null,
    brandFg: s?.brandFg ?? null,
    brandMuted: s?.brandMuted ?? null,
  });

  if (etagMatches(ifNoneMatch, version)) {
    return { version, notModified: true, payload: null };
  }

  const config = normalizePrinterConfig(s?.printerScreens ?? s?.printerLayout);

  // Presign uploaded icon keys across all screens (collect → presign → map back).
  const iconKeys = new Set<string>();
  for (const screen of PRINTER_SCREENS) {
    for (const o of config.screens[screen].objects) {
      if (o.type === "icon" && o.icon?.source === "upload" && o.icon.url) iconKeys.add(o.icon.url);
    }
  }
  const signed = new Map<string, string>();
  await Promise.all([...iconKeys].map(async (k) => signed.set(k, await presignedGetUrl(k))));
  for (const screen of PRINTER_SCREENS) {
    for (const o of config.screens[screen].objects) {
      if (o.type === "icon" && o.icon?.source === "upload" && o.icon.url) {
        o.icon = { ...o.icon, signedUrl: signed.get(o.icon.url) ?? undefined };
      }
    }
  }

  const logoUrl = s?.logoUrl ? await presignedGetUrl(s.logoUrl) : null;
  const brandColor = s?.brandColor ?? "#10A765";
  const tokens = resolveBrandTokens(brandColor, { bg: s?.brandBg, fg: s?.brandFg, muted: s?.brandMuted });

  return {
    version,
    notModified: false,
    payload: {
      version,
      brandColor,
      brandBg: tokens.bg,
      brandFg: tokens.fg,
      brandMuted: tokens.muted,
      logoUrl,
      config,
    },
  };
}
```

- [ ] **Step 3: Add the `etagMatches` import**

Update the import added in Step 1 to:

```ts
import { computeConfigVersion, etagMatches } from "@/lib/device-config";
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/data.ts
git commit -m "feat(device): getDeviceConfig data function with ETag short-circuit"
```

---

### Task 7: `GET /api/device/config` route

**Files:**
- Create: `app/api/device/config/route.ts`

- [ ] **Step 1: Write the route**

```ts
// GET /api/device/config — device fetches its display config (device key auth).
// Doubles as a heartbeat (bumps lastSeenAt). Honors If-None-Match → 304.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable } from "@/lib/db/schema";
import { authenticateDevice } from "@/lib/device-auth";
import { getDeviceConfig } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const device = await authenticateDevice(req);
  if (!device) return NextResponse.json({ error: "Unknown or missing device key" }, { status: 401 });

  const ifNoneMatch = req.headers.get("if-none-match");
  const { version, notModified, payload } = await getDeviceConfig(device.organizationId, ifNoneMatch);

  // Heartbeat: bump lastSeenAt + mark online (unless paused).
  const now = new Date();
  await db
    .update(deviceTable)
    .set({ lastSeenAt: now, ...(device.status === "paused" ? {} : { status: "online" }) })
    .where(eq(deviceTable.id, device.id));

  if (notModified) {
    return new NextResponse(null, { status: 304, headers: { ETag: `"${version}"` } });
  }
  return NextResponse.json(payload, {
    status: 200,
    headers: { ETag: `"${version}"`, "Cache-Control": "no-cache" },
  });
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS — route compiles and is registered.

- [ ] **Step 3: Manual smoke (optional, needs seeded device key)**

Run the dev server, then:
```bash
curl -i -H "Authorization: Bearer <claimed-device-key>" http://localhost:3000/api/device/config
```
Expected: `200` with JSON body + an `ETag` header. Re-run with `-H 'If-None-Match: "<that-etag>"'` → `304` with no body.

- [ ] **Step 4: Commit**

```bash
git add app/api/device/config/route.ts
git commit -m "feat(device): GET /api/device/config endpoint with ETag/304"
```

---

### Task 8: Nudge devices with `config-changed` on branding save

**Files:**
- Modify: `lib/data.ts` (add `enqueueConfigChangedForOrg` helper)
- Modify: `app/(tenant)/tenant/branding/actions.ts` (call it after a successful save)

- [ ] **Step 1: Add the bulk-enqueue helper to `lib/data.ts`**

Ensure `deviceCommand` and `device` are imported from the schema (they may not be in `data.ts` yet — add them to the existing schema import) and `id as genId` from `@/lib/ids`. Then append:

```ts
/**
 * Enqueue a config-changed command for EVERY device in an org so they re-pull
 * GET /api/device/config promptly after a branding change. No-op if the org has
 * no devices. Fire-and-forget from the caller's perspective.
 */
export async function enqueueConfigChangedForOrg(
  organizationId: string,
  createdByUserId: string | null,
): Promise<void> {
  const devices = await db
    .select({ id: deviceTable.id })
    .from(deviceTable)
    .where(eq(deviceTable.organizationId, organizationId));
  if (devices.length === 0) return;
  await db.insert(deviceCommand).values(
    devices.map((d) => ({
      id: genId("cmd"),
      deviceId: d.id,
      organizationId,
      type: "config-changed" as const,
      createdByUserId: createdByUserId ?? undefined,
    })),
  );
}
```

(If `data.ts` aliases the device table differently — e.g. `deviceTable` — match the existing alias used elsewhere in the file. Use the same `settingsTable`/`receiptTable` aliasing convention already present.)

- [ ] **Step 2: Call it after the branding upsert**

In `app/(tenant)/tenant/branding/actions.ts`, after the audit record / `revalidatePath` block at the end of the save (after line ~229), and only when the layout/branding actually changed, add:

```ts
  // Nudge this org's devices to re-pull their display config.
  await enqueueConfigChangedForOrg(organizationId, ctx.user.id);
```

Add the import at the top of the file:

```ts
import { enqueueConfigChangedForOrg } from "@/lib/data";
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: PASS (no behavior covered by unit tests changed; this verifies nothing regressed).

- [ ] **Step 5: Manual smoke (optional)**

With the dev server running and a claimed device: save branding in the admin UI, then `curl` the commands endpoint as that device:
```bash
curl -H "Authorization: Bearer <device-key>" http://localhost:3000/api/device/commands
```
Expected: a `config-changed` command appears in the returned `commands` array.

- [ ] **Step 6: Commit**

```bash
git add lib/data.ts "app/(tenant)/tenant/branding/actions.ts"
git commit -m "feat(device): enqueue config-changed on branding save"
```

---

## Self-Review

**Spec coverage (M1, §4 of the spec):**
- §4.1 unified model (nullable deviceId, `source`, `metadata`) → Task 1 ✓
- §4.2 ingest persists metadata + `source="device"`, no ESC/POS parsing → Tasks 2–3 ✓
- §4.3 `GET /api/device/config` with ETag/304 + heartbeat → Tasks 5–7 ✓
- §4.4 `config-changed` command type + enqueue on branding save → Tasks 4, 8 ✓
- §4.5 cloud-ingested → schema readiness only (Task 1); POST endpoint deferred per planning note ✓
- §4.6 acceptance criteria → covered across Tasks 1–8 (migration clean, metadata persisted, config 304 honored, config-changed delivered via existing /commands flow) ✓

**Placeholder scan:** No TBD/TODO; every code step carries complete code and exact commands. ✓

**Type consistency:** `ReceiptMetadata` (Task 2) is the type used in Task 3's ingest wiring and the Task 1 `metadata jsonb` column. `ConfigVersionInput` / `computeConfigVersion` / `etagMatches` (Task 5) are consumed verbatim in Task 6. `DeviceConfigPayload` (Task 6) is the return type rendered by the Task 7 route. `COMMAND_TYPES` includes `config-changed` (Task 4) before it is inserted in Task 8. `enqueueConfigChangedForOrg` signature (Task 8 Step 1) matches its call site (Step 2). ✓

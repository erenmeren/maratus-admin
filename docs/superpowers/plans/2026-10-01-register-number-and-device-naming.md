# Register number, device naming, trigger-by-register — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let customers name devices and attach a register (kasa) number, trigger a device by that number, and let platform admins return RMA/retired serials to stock.

**Architecture:** One nullable `device.register_number` column with an org-scoped, case-insensitive partial unique index. Pure helpers (`lib/register-number.ts`, `lib/device-name.ts`) hold validation and default naming and are unit-tested; server actions and a shared trigger handler (`lib/api/trigger-device.ts`) wrap them. The two trigger routes become thin wrappers around the handler.

**Tech Stack:** Next.js 16 App Router, Drizzle (neon-http + `dbTx` pool for transactions), Better Auth, vitest (`lib/**/*.test.ts` only), shadcn radix-nova.

**Spec:** `docs/superpowers/specs/2026-10-01-register-number-and-device-naming-design.md`

**NOTE:** `AGENTS.md` says this Next.js has breaking changes — read the relevant guide in `node_modules/next/dist/docs/` before touching routes/actions. `.env.local` points at PROD; Task 2's migration is additive.

## Global Constraints

- Register number: trimmed, 1–40 chars of `A-Z a-z 0-9 . _ -`; empty input → `null`; stored as entered; compared via `lower()`; unique per `organization_id` (org-wide).
- Default device name: `device_{n}`, `n` = highest existing `device_<digits>` suffix in the org + 1 (1 when none).
- New trigger route: `POST /api/v1/registers/{registerNumber}/trigger` — `devices:trigger` scope, required `Idempotency-Key`, body `{action, payload:{url}}`, 202 `{id,status:"queued"}`; unknown register → `404 register_not_found`.
- Return to stock: only `rma`/`retired` rows with no linked device (`deviceId` null); sets `manufactured` and clears `allocatedOrganizationId/allocatedStoreId/deviceId/claimedAt`.
- Tenant edits require `canManageTenant`; platform admin may edit any device; archived orgs are read-only (`isOrgArchived`).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Money/billing code is untouched.

## Review Focus

- Register number `K1` vs `k1` in the same org → second is rejected (case-insensitive). Tested in Task 1 (`registerKey`) and enforced by the index (Task 2).
- Same register number in two different orgs → allowed; trigger resolves only inside the caller's org (route test via `resolveRegisterDevice` filter, Task 5).
- Register number with `/`, spaces inside, unicode, or 41 chars → rejected with a clear message (Task 1).
- Deleting `device_3` then claiming → next is `device_4` or higher, never a duplicate (Task 1).
- Return-to-stock on a row that still has a device → refused; on an already-`manufactured` row → ok/no-op (Task 6).

---

### Task 1: Pure helpers (register number + default device name)

**Files:**
- Create: `lib/register-number.ts`, `lib/register-number.test.ts`, `lib/device-name.ts`, `lib/device-name.test.ts`

**Interfaces:**
- Produces:
  - `parseRegisterNumber(input: string | null | undefined): { ok: true; value: string | null } | { ok: false; error: string }`
  - `registerKey(value: string): string` (lowercase comparison key)
  - `isUniqueViolation(err: unknown): boolean`
  - `defaultDeviceName(existingNames: string[]): string`

- [ ] **Step 1: Write failing tests**

`lib/register-number.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseRegisterNumber, registerKey, isUniqueViolation } from "./register-number";

describe("parseRegisterNumber", () => {
  it("trims and keeps case", () => {
    expect(parseRegisterNumber("  Kasa-01 ")).toEqual({ ok: true, value: "Kasa-01" });
  });
  it("treats empty / whitespace / nullish as null", () => {
    expect(parseRegisterNumber("")).toEqual({ ok: true, value: null });
    expect(parseRegisterNumber("   ")).toEqual({ ok: true, value: null });
    expect(parseRegisterNumber(null)).toEqual({ ok: true, value: null });
    expect(parseRegisterNumber(undefined)).toEqual({ ok: true, value: null });
  });
  it("accepts letters digits . _ -", () => {
    expect(parseRegisterNumber("IST.01_K-2")).toEqual({ ok: true, value: "IST.01_K-2" });
  });
  it("rejects slash, inner space, unicode", () => {
    for (const bad of ["a/b", "a b", "kasa№1", "ğüş"]) {
      expect(parseRegisterNumber(bad).ok).toBe(false);
    }
  });
  it("rejects 41 chars, accepts 40", () => {
    expect(parseRegisterNumber("a".repeat(40)).ok).toBe(true);
    expect(parseRegisterNumber("a".repeat(41)).ok).toBe(false);
  });
});

describe("registerKey", () => {
  it("is case-insensitive", () => {
    expect(registerKey("K1")).toBe(registerKey("k1"));
  });
});

describe("isUniqueViolation", () => {
  it("detects 23505 directly and via cause", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
    expect(isUniqueViolation({ code: "42P01" })).toBe(false);
    expect(isUniqueViolation(new Error("x"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
```
`lib/device-name.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { defaultDeviceName } from "./device-name";

describe("defaultDeviceName", () => {
  it("starts at device_1", () => {
    expect(defaultDeviceName([])).toBe("device_1");
  });
  it("uses highest suffix + 1, not a count (gaps from deletions)", () => {
    expect(defaultDeviceName(["device_1", "device_7"])).toBe("device_8");
  });
  it("ignores names that do not match exactly", () => {
    expect(defaultDeviceName(["Printer a1b2", "device_x", "my device_9", "device_2b"])).toBe("device_1");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/register-number.test.ts lib/device-name.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`lib/register-number.ts`:
```ts
// Register (kasa) number: the customer's own label for the till a device sits
// at. Used in the URL of the trigger-by-register endpoint, so it is restricted
// to URL-safe characters. Unique per org, case-insensitively (see device table).

export const REGISTER_NUMBER_MAX = 40;
const REGISTER_RE = /^[A-Za-z0-9._-]+$/;

export type ParsedRegister =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export function parseRegisterNumber(input: string | null | undefined): ParsedRegister {
  const v = (input ?? "").trim();
  if (!v) return { ok: true, value: null };
  if (v.length > REGISTER_NUMBER_MAX) {
    return { ok: false, error: `Register number can be at most ${REGISTER_NUMBER_MAX} characters.` };
  }
  if (!REGISTER_RE.test(v)) {
    return { ok: false, error: "Register number may only contain letters, digits, '.', '_' and '-'." };
  }
  return { ok: true, value: v };
}

/** Comparison key — mirrors the lower() in the unique index. */
export function registerKey(value: string): string {
  return value.toLowerCase();
}

/** Postgres unique violation, directly or wrapped (drizzle puts it on `cause`). */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; cause?: unknown };
  if (e.code === "23505") return true;
  return isUniqueViolation(e.cause);
}
```
`lib/device-name.ts`:
```ts
// Default device names: device_1, device_2, … Highest-suffix + 1 (not a count)
// so deleting a device never makes the next claim collide with a survivor.

const DEFAULT_RE = /^device_(\d+)$/;

export function defaultDeviceName(existingNames: string[]): string {
  let max = 0;
  for (const n of existingNames) {
    const m = DEFAULT_RE.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `device_${max + 1}`;
}
```
Careful: `isUniqueViolation(null)` must return false — covered by the guard.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/register-number.test.ts lib/device-name.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add lib/register-number* lib/device-name* && git commit -m "feat: register-number and default device-name helpers"`

---

### Task 2: Schema column, migration, view-model

**Files:**
- Modify: `lib/db/schema.ts` (device table + indexes), `lib/types.ts` (`Device`), `lib/data.ts` (~line 295 `toDevice` mapper)
- Create: `drizzle/0048_*.sql` (generated)

**Interfaces:**
- Produces: `device.registerNumber` column; `Device.registerNumber: string | null`.

- [ ] **Step 1: Schema.** In the `device` table add after `serialConflict`:
```ts
    // Customer's own till label (kasa no). Optional; unique per org,
    // case-insensitively (index below). Addresses the trigger-by-register API.
    registerNumber: text("register_number"),
```
and in the index list:
```ts
    uniqueIndex("device_org_register_number_idx")
      .on(t.organizationId, sql`lower(${t.registerNumber})`)
      .where(sql`${t.registerNumber} is not null`),
```
(Import `sql` from `drizzle-orm` if not already imported in the file.)

- [ ] **Step 2: Generate and trim the migration.** Run `npm run db:generate`. Drizzle snapshot drift can add unrelated FK churn: open the new `drizzle/0048_*.sql` and keep ONLY:
```sql
ALTER TABLE "device" ADD COLUMN "register_number" text;
CREATE UNIQUE INDEX "device_org_register_number_idx" ON "device" USING btree ("organization_id", lower("register_number")) WHERE "device"."register_number" is not null;
```
- [ ] **Step 3: View-model.** `lib/types.ts` `Device`: add `registerNumber: string | null;`. In `lib/data.ts` mapper add `registerNumber: d.registerNumber,`. Fix any other place that constructs a `Device` literal (`npx tsc --noEmit` lists them).
- [ ] **Step 4: Apply** `npm run db:migrate` (additive; prod). Verify: `npx tsx` one-off selecting `register_number` or `\d device` equivalent returns the column.
- [ ] **Step 5:** `npx tsc --noEmit` clean; `npx vitest run` green. Commit `feat(db): device.register_number with org-wide case-insensitive uniqueness`.

---

### Task 3: Default names + optional name/register at claim

**Files:**
- Create: `lib/device-name-db.ts`
- Modify: `lib/device-claim.ts`, `lib/factory-registry.ts:~453`, `lib/actions/devices.ts` (`provisionDevice`), `app/(tenant)/tenant/stores/[storeId]/actions.ts`, `components/claim-device-dialog.tsx`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 column.
- Produces: `nextDeviceName(organizationId: string): Promise<string>`; `claimDevice(pairingCode, storeId, opts?: { name?: string; registerNumber?: string | null })`; `claimDeviceAction(storeId, pairingCodeRaw, opts?: { name?: string; registerNumber?: string })`.

- [ ] **Step 1:** `lib/device-name-db.ts`:
```ts
import { eq } from "drizzle-orm";
import { db } from "./db";
import { device as deviceTable } from "./db/schema";
import { defaultDeviceName } from "./device-name";

export async function nextDeviceName(organizationId: string): Promise<string> {
  const rows = await db
    .select({ name: deviceTable.name })
    .from(deviceTable)
    .where(eq(deviceTable.organizationId, organizationId));
  return defaultDeviceName(rows.map((r) => r.name));
}
```
- [ ] **Step 2: `claimDevice`.** Add `opts` param. Validate with `parseRegisterNumber(opts?.registerNumber)` (throw `new Error(parsed.error)` if not ok). Resolve `const customName = opts?.name?.trim()`. Bind path: the existing row already has a name; set `name: customName || existing.name` and `registerNumber` in the `.set({...})`. Create-row path: `const name = customName || (await nextDeviceName(store.organizationId));` replacing `"New Printer"`, and set `registerNumber` in `.values`. Wrap both writes so a unique violation throws `new Error("Register number already in use")` (use `isUniqueViolation`; in the create-row path the existing 23505 branch means pairing code — distinguish by checking `String((err as any)?.message ?? "")` / constraint name contains `register_number`; if the constraint cannot be read, check for an existing device with `registerKey` before inserting and throw the friendly error instead — do the pre-check query in both paths, it is simpler and deterministic).
- [ ] **Step 3: Auto-claim.** In `autoClaimDevice` compute `const name = await nextDeviceName(<org>)` — the org is only known inside the transaction, so first read the allocation: `const [alloc] = await db.select({ org: factoryDevice.allocatedOrganizationId }).from(factoryDevice).where(eq(factoryDevice.serial, serial)).limit(1);` before the transaction; `const autoName = alloc?.org ? await nextDeviceName(alloc.org) : \`device_1\`;` and use `name: autoName` instead of `` `Printer ${serial.slice(-4)}` ``. (Concurrent claims may duplicate a default name; names are not unique, accepted.)
- [ ] **Step 4: `provisionDevice`.** Replace both `name.trim() || "New Printer"` with a single `const finalName = name.trim() || (await nextDeviceName(organizationId));` used for insert and audit metadata.
- [ ] **Step 5: Action.** `claimDeviceAction(storeId, pairingCodeRaw, opts?)` passes `opts` through to `claimDevice`; map `message.includes("Register number")` to `{ ok:false, error: message }`.
- [ ] **Step 6: Dialog.** In the claim form add two optional inputs under the pairing code: `Name` (placeholder `device_1`, `maxLength=60`) and `Register number` (placeholder `e.g. K1`, `maxLength=40`, helper text "Your own till number — lets your POS trigger this device by it."). Keep state `name`, `registerNumber`; pass `{ name, registerNumber }` to `claimDeviceAction`; reset them in `reset()`.
- [ ] **Step 7:** `npx tsc --noEmit`, `npx vitest run`. Manual: `npm run dev`, claim with/without fields. Commit `feat: default device_{n} names; name + register number at claim`.

---

### Task 4: Edit device (name + register number) + display

**Files:**
- Modify: `lib/actions/devices.ts` (add `updateDeviceDetails`, make `renameDevice` delegate), `lib/audit.ts` + `lib/audit-labels.ts` (new `deviceRegisterChanged: "device.register_changed"` and its label), `components/device-row-actions.tsx` (rename dialog → edit dialog), `app/(tenant)/tenant/stores/[storeId]/[deviceId]/page.tsx`, `components/device-card.tsx`
- Create: `components/edit-device-dialog.tsx`

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 column.
- Produces: `updateDeviceDetails(deviceId: string, patch: { name?: string; registerNumber?: string | null }): Promise<ActionResult>`; `<EditDeviceDialog deviceId name registerNumber open onOpenChange />`.

- [ ] **Step 1: Action** (append to `lib/actions/devices.ts`):
```ts
export async function updateDeviceDetails(
  deviceId: string,
  patch: { name?: string; registerNumber?: string | null },
): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const [device] = await db
    .select({
      organizationId: deviceTable.organizationId,
      storeId: deviceTable.storeId,
      name: deviceTable.name,
      registerNumber: deviceTable.registerNumber,
    })
    .from(deviceTable)
    .where(eq(deviceTable.id, deviceId))
    .limit(1);
  if (!device) return { ok: false, error: "Device not found." };

  const isPlatform = ctx.user.role === "platform_admin";
  if (!isPlatform) {
    const m = ctx.organizations.find((o) => o.id === device.organizationId);
    if (!m || m.id !== ctx.activeOrganizationId || !canManageTenant(m.role)) {
      return { ok: false, error: "You don't have permission to edit this device." };
    }
  }
  if (await isOrgArchived(device.organizationId)) {
    return { ok: false, error: "Customer is archived." };
  }

  const set: { name?: string; registerNumber?: string | null } = {};
  if (patch.name !== undefined) {
    const clean = patch.name.trim();
    if (!clean) return { ok: false, error: "Name is required." };
    if (clean.length > 60) return { ok: false, error: "Name can be at most 60 characters." };
    set.name = clean;
  }
  if (patch.registerNumber !== undefined) {
    const parsed = parseRegisterNumber(patch.registerNumber);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    set.registerNumber = parsed.value;
  }
  if (Object.keys(set).length === 0) return { ok: true };

  try {
    await db.update(deviceTable).set(set).where(eq(deviceTable.id, deviceId));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: "That register number is already used by another device." };
    }
    throw err;
  }

  const actor = { type: "user" as const, id: ctx.user.id, label: ctx.user.email };
  if (set.name !== undefined && set.name !== device.name) {
    await recordAudit({ organizationId: device.organizationId, actor, action: AUDIT.deviceRenamed, target: { type: "device", id: deviceId }, metadata: { name: set.name } });
  }
  if (set.registerNumber !== undefined && set.registerNumber !== device.registerNumber) {
    await recordAudit({ organizationId: device.organizationId, actor, action: AUDIT.deviceRegisterChanged, target: { type: "device", id: deviceId }, metadata: { from: device.registerNumber, to: set.registerNumber } });
  }

  revalidatePath("/admin/devices");
  revalidatePath(`/admin/devices/${deviceId}`);
  revalidatePath(`/admin/customers/${device.organizationId}`);
  if (device.storeId) {
    revalidatePath(`/tenant/stores/${device.storeId}`);
    revalidatePath(`/tenant/stores/${device.storeId}/${deviceId}`);
  }
  return { ok: true };
}
```
Imports to add: `getContext` from `@/lib/session`, `parseRegisterNumber`, `isUniqueViolation` from `@/lib/register-number`. Replace the body of `renameDevice` with `return updateDeviceDetails(deviceId, { name })` (keep its signature; it is still used by `DeviceRowActions` until Step 3).
- [ ] **Step 2: Audit.** Add `deviceRegisterChanged: "device.register_changed"` next to `deviceRenamed` in `lib/audit.ts` and a label ("Register number changed") in `lib/audit-labels.ts` following its existing pattern; run `npx vitest run lib/audit-labels.test.ts` (it asserts every action has a label).
- [ ] **Step 3: Dialog.** `components/edit-device-dialog.tsx` (client): a shadcn `Dialog` with two `Input`s (Name required, Register number optional + helper "Letters, digits, . _ - · unique in your account"), Save calls `updateDeviceDetails(deviceId, { name, registerNumber })`, `toast.success("Device updated")` / `toast.error(res.error)`, then `router.refresh()` and closes. In `DeviceRowActions` replace the rename dialog + `renameDevice` call with this dialog (pass `registerNumber` as a new optional prop) and rename the menu item to "Edit details"; update the two callers (`admin/customers/[tenantId]/page.tsx`, `admin/devices/[deviceId]/page.tsx`) to pass `registerNumber`.
- [ ] **Step 4: Tenant surfaces.** On the tenant device detail page add an "Edit" button (only when `canManage`) opening the dialog beside `PageHeader`, and add a `Register number` row to the `specs` list (`value: device.registerNumber ?? "—"`, `mono: true`, `copy: !!device.registerNumber`, icon `Hash` from lucide). In `DeviceCard` show `device.registerNumber` as a small `Register {n}` line under the id when set.
- [ ] **Step 5:** `npx tsc --noEmit`, `npx vitest run`. Manual check in dev: edit name, set duplicate register number (expect friendly error), clear it. Commit `feat: edit device name and register number`.

---

### Task 5: Trigger by register + docs

**Files:**
- Create: `lib/api/trigger-device.ts`, `app/api/v1/registers/[registerNumber]/trigger/route.ts`
- Modify: `app/api/v1/devices/[deviceId]/trigger/route.ts`, `openapi.json`, `lib/docs-spec.test.ts`

**Interfaces:**
- Produces: `handleTrigger(req: Request, resolve: (organizationId: string) => Promise<DeviceRow | null>, notFound: { code: string; message: string }): Promise<Response>`.

- [ ] **Step 1: Extract.** Move the whole body of `POST` in `app/api/v1/devices/[deviceId]/trigger/route.ts` (everything from `guardApiRequest` through the final success response) into `lib/api/trigger-device.ts` as `handleTrigger`. The only edits inside: the lookup block becomes
```ts
  const dev = await resolve(auth.organizationId);
  if (!dev) return apiError(notFound.code, notFound.message, 404);
  const deviceId = dev.id;
```
(keep `runtime`/`TTL_MS`; every later use of `deviceId` stays). Export the `DeviceRow` type as `typeof deviceTable.$inferSelect`.
- [ ] **Step 2: Rewire the device route:**
```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable } from "@/lib/db/schema";
import { handleTrigger } from "@/lib/api/trigger-device";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  return handleTrigger(
    req,
    async (organizationId) => {
      const [dev] = await db.select().from(deviceTable)
        .where(and(eq(deviceTable.id, deviceId), eq(deviceTable.organizationId, organizationId))).limit(1);
      return dev ?? null;
    },
    { code: "device_not_found", message: "Device not found." },
  );
}
```
- [ ] **Step 3: Register route** `app/api/v1/registers/[registerNumber]/trigger/route.ts`:
```ts
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable } from "@/lib/db/schema";
import { handleTrigger } from "@/lib/api/trigger-device";
import { registerKey } from "@/lib/register-number";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ registerNumber: string }> }) {
  const { registerNumber } = await params;
  const key = registerKey(decodeURIComponent(registerNumber));
  return handleTrigger(
    req,
    async (organizationId) => {
      const [dev] = await db.select().from(deviceTable)
        .where(and(eq(deviceTable.organizationId, organizationId), sql`lower(${deviceTable.registerNumber}) = ${key}`))
        .limit(1);
      return dev ?? null;
    },
    { code: "register_not_found", message: "No device has that register number." },
  );
}
```
Check whether `proxy`/middleware path rules or the `/v1` rewrite and CORS in `next.config.ts` need an entry for the new path (they use prefix matching for `/api/v1`; confirm).
- [ ] **Step 4: OpenAPI.** In `openapi.json` add path `/registers/{registerNumber}/trigger` by copying `/devices/{deviceId}/trigger` with: `operationId: "triggerRegister"`, summary "Trigger a device by register number", path param `registerNumber` (description "The register (kasa) number you assigned to the device in the console; unique in your organization, case-insensitive.", example `K1`), error `404 register_not_found` in place of `device_not_found`. Add a doc test in `lib/docs-spec.test.ts`:
```ts
it("documents trigger-by-register", () => {
  expect(Object.keys(openapi.paths)).toContain("/registers/{registerNumber}/trigger");
});
```
- [ ] **Step 5:** Run `npx vitest run lib/docs-spec.test.ts`, `npx tsc --noEmit`. Manual: with dev server and a playground/API key, `curl -X POST localhost:3000/api/v1/registers/K1/trigger -H "Authorization: Bearer …" -H "Idempotency-Key: t1" -d '{"action":"show_qr","payload":{"url":"https://example.com"}}'` → 404 for unknown, 202/409 for a real one; device-id route behaves as before. Commit `feat(api): trigger by register number`.

---

### Task 6: Return to stock (inventory)

**Files:**
- Create: `lib/registry-return.ts`, `lib/registry-return.test.ts`
- Modify: `lib/factory-registry.ts` (add `returnSerialToStock`), `lib/actions/inventory.ts` (+action), `components/inventory/inventory-table.tsx` (menu + dialog), `lib/audit.ts`/`lib/audit-labels.ts` (`registryReturnedToStock`)

**Interfaces:**
- Produces: `returnToStockBlocker(row: { status: string; deviceId: string | null }): string | null`; `returnSerialToStock(serial: string): Promise<{ ok: boolean; error?: string; changed: boolean; organizationId: string | null }>`; `returnSerialToStockAction(serial: string): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Failing test** `lib/registry-return.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { returnToStockBlocker } from "./registry-return";

describe("returnToStockBlocker", () => {
  it("allows rma/retired with no device", () => {
    expect(returnToStockBlocker({ status: "rma", deviceId: null })).toBeNull();
    expect(returnToStockBlocker({ status: "retired", deviceId: null })).toBeNull();
  });
  it("refuses while a device row is still linked", () => {
    expect(returnToStockBlocker({ status: "rma", deviceId: "dev_1" })).toMatch(/Delete the device first/);
  });
  it("is a no-op marker for manufactured", () => {
    expect(returnToStockBlocker({ status: "manufactured", deviceId: null })).toBe("noop");
  });
  it("refuses allocated/claimed (use the existing deallocate / revert flows)", () => {
    expect(returnToStockBlocker({ status: "allocated", deviceId: null })).toMatch(/RMA or retired/);
    expect(returnToStockBlocker({ status: "claimed", deviceId: null })).toMatch(/RMA or retired/);
  });
});
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** implement `lib/registry-return.ts`:
```ts
export function returnToStockBlocker(row: { status: string; deviceId: string | null }): string | null {
  if (row.status === "manufactured") return "noop";
  if (row.status !== "rma" && row.status !== "retired") {
    return "Only RMA or retired serials can be returned to stock.";
  }
  if (row.deviceId) return "Delete the device first, then return the serial to stock.";
  return null;
}
```
Run → PASS.
- [ ] **Step 4: Registry fn** in `lib/factory-registry.ts`:
```ts
export async function returnSerialToStock(serial: string) {
  const [row] = await db
    .select({ status: factoryDevice.status, deviceId: factoryDevice.deviceId, org: factoryDevice.allocatedOrganizationId })
    .from(factoryDevice).where(eq(factoryDevice.serial, serial)).limit(1);
  if (!row) return { ok: false, error: "Serial not found.", changed: false, organizationId: null };
  const blocker = returnToStockBlocker(row);
  if (blocker === "noop") return { ok: true, changed: false, organizationId: null };
  if (blocker) return { ok: false, error: blocker, changed: false, organizationId: null };
  await db.update(factoryDevice)
    .set({ status: "manufactured", allocatedOrganizationId: null, allocatedStoreId: null, deviceId: null, claimedAt: null })
    .where(and(eq(factoryDevice.serial, serial), inArray(factoryDevice.status, ["rma", "retired"])));
  return { ok: true, changed: true, organizationId: row.org };
}
```
(import `returnToStockBlocker`, and `inArray` if missing.)
- [ ] **Step 5: Action** in `lib/actions/inventory.ts` (zod-parse `serial` with the existing serial schema used by `setStatusInputSchema`; `requirePlatformAdmin`; audit `AUDIT.registryReturnedToStock` with `{serial}` only when `changed && organizationId`; `revalidatePath("/admin/inventory")`). Add the audit key `registryReturnedToStock: "registry.returned_to_stock"` + label.
- [ ] **Step 6: UI.** In `inventory-table.tsx`, for rows with `status === "rma" || status === "retired"` add a `DropdownMenuItem` "Return to stock…" opening a confirm `Dialog` ("Return {serial} to stock? It becomes available to allocate again.") that calls the action, toasts, and `router.refresh()`es. Model it on the existing `rmaRow` dialog in the same file.
- [ ] **Step 7:** `npx vitest run`, `npx tsc --noEmit`. Commit `feat(inventory): return RMA/retired serials to stock`.

---

### Task 7: Verify, document, deploy

- [ ] `npx vitest run` and `npx tsc --noEmit` and `npm run lint` all clean.
- [ ] Update `CLAUDE.md` Data model/Device trigger sections with: `device.registerNumber`, the register trigger route, default `device_{n}` naming (3–4 lines, no churn elsewhere).
- [ ] Final review of the whole branch diff against the spec (`/code-review` or a fresh reviewer).
- [ ] Commit, push, `vercel --prod --yes` (migration was applied in Task 2 and is additive, so old code keeps working until the deploy). Smoke: `/login` 200; the new route returns 401 without a key (`curl -X POST https://console.maratus.co/api/v1/registers/K1/trigger`).
- [ ] Re-return the stuck serial `e8f60ae0b580` from the Inventory UI, allocate it to the org, and confirm the bench device auto-claims as `device_1`.

# Customer Offboarding & Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a platform admin offboard a churned customer — decide each device's fate, revoke access, freeze credit history — as a reversible archive that keeps all financial/audit data and hides the customer from day-to-day operations.

**Architecture:** "Delete" is a lifecycle transition, never row deletion. `tenantSettings` gains `archivedAt`/`archivedNote`; a three-step server action (device dispositions → access shutdown → archive stamp) runs idempotently and stamps `archivedAt` last. `requireTenant` becomes the single access gate; the data layer excludes archived orgs by default. A wizard dialog on the admin customer-detail page drives it; an `Active|Archived|All` filter + read-only archived detail + Restore complete the UI.

**Tech Stack:** Next.js 16 App Router + React 19, Drizzle/Neon, Better Auth (org plugin), vitest, shadcn radix-nova.

**Spec:** `docs/superpowers/specs/2026-07-10-customer-offboarding-archive-design.md`

## Global Constraints

- TypeScript strict; `@/*` → repo root. This Next.js 16 may differ from training data — check `node_modules/next/dist/docs/` before unfamiliar APIs.
- shadcn style `radix-nova` — never introduce base-color react-aria components (they lack `asChild`).
- No feature row is ever deleted EXCEPT device rows chosen "return to stock" (deliberate identity retirement; the record survives in the `org.archived` audit metadata + `device.returned_to_stock` audit).
- Archived = `tenantSettings.archivedAt IS NOT NULL`. The separate `tenantSettings.status` (`active|paused`) is operational state and MUST NOT be read or written by this feature.
- Every offboarding step is independently idempotent; `archivedAt` is written ONLY after all steps succeed, so a half-run org stays visibly active and is safely re-runnable.
- Device "return to stock" = delete device row + registry row → `manufactured` (clear org/store/deviceId/claimedAt), in `dbTx` + `SELECT FOR UPDATE`, mirroring `revertRegistryClaim`/`deallocateSerials` in `lib/factory-registry.ts`. "Leave with customer" = device `status:"paused"` + registry row → `retired` (keep `deviceId`).
- Allocation sweep: after per-device handling, revert ALL still-`allocated` factory rows of the org to `manufactured` (reuse `deallocateSerials`) — else zero-touch auto-claim could still mint a key for the archived org.
- All offboarding/restore actions are platform-admin-only (`requirePlatformAdmin()` first).
- New audit constants + labels (completeness guard test enforces pairs): `org.archived`, `org.restored`, `device.returned_to_stock`, `device.left_with_customer`.
- Drizzle migration hazard: after `db:generate`, strip the SQL to only this feature's 2 columns. Do NOT run `db:migrate` against prod in a task (deploy-time step).
- Money is integer cents; credits are frozen as-is (no refund flow).
- Test: `npm test` (vitest). Seed admin: `admin@maratus.app` / `123456`; org "Roastwell Coffee" (`dana@roastwell.co` / `123456`).
- Commit per task on `main`.

---

### Task 1: Schema + audit constants + migration

**Files:**
- Modify: `lib/db/schema.ts` (tenantSettings table, ~line 198-205)
- Modify: `lib/audit.ts` (AUDIT object, ~line 48-49), `lib/audit-labels.ts` (AUDIT_LABELS)
- Create: `drizzle/0031_<generated>.sql` (via `npm run db:generate`, trimmed)

**Interfaces:**
- Produces (used by all later tasks): `tenantSettings.archivedAt` (timestamp, nullable), `tenantSettings.archivedNote` (text, nullable); `AUDIT.orgArchived = "org.archived"`, `AUDIT.orgRestored = "org.restored"`, `AUDIT.deviceReturnedToStock = "device.returned_to_stock"`, `AUDIT.deviceLeftWithCustomer = "device.left_with_customer"`.

- [ ] **Step 1: Add columns to `tenantSettings` in `lib/db/schema.ts`**

Find the `tenantSettings` pgTable (has `status: text("status", { enum: ["active","paused"] })`). After the `status` column add:

```ts
    // Customer-offboarding lifecycle: non-null once archived (soft delete).
    // Independent of `status` (operational pause) above.
    archivedAt: timestamp("archived_at"),
    archivedNote: text("archived_note"),
```

- [ ] **Step 2: Add audit constants in `lib/audit.ts`**

Append inside the `AUDIT` object:

```ts
  orgArchived: "org.archived",
  orgRestored: "org.restored",
  deviceReturnedToStock: "device.returned_to_stock",
  deviceLeftWithCustomer: "device.left_with_customer",
```

- [ ] **Step 3: Add labels in `lib/audit-labels.ts`**

Append to `AUDIT_LABELS`:

```ts
  "org.archived": "Customer archived",
  "org.restored": "Customer restored",
  "device.returned_to_stock": "Device returned to stock",
  "device.left_with_customer": "Device left with customer",
```

- [ ] **Step 4: Generate + trim migration**

```bash
npm run db:generate
```

Open the new `drizzle/0031_*.sql` and keep ONLY:
```sql
ALTER TABLE "tenant_settings" ADD COLUMN "archived_at" timestamp;
ALTER TABLE "tenant_settings" ADD COLUMN "archived_note" text;
```
Delete any other statement (snapshot-drift churn) from the `.sql` file; leave `drizzle/meta/` as generated.

- [ ] **Step 5: Verify + commit**

Run: `npm test` — Expected: PASS (audit-labels completeness guard now covers the 4 new constants).
Run: `npm run build` — Expected: clean.

```bash
git add lib/db/schema.ts lib/audit.ts lib/audit-labels.ts drizzle/
git commit -m "feat(offboarding): tenantSettings archive columns + audit constants + migration 0031"
```

---

### Task 2: Pure offboarding logic (device disposition + summary + status)

**Files:**
- Create: `lib/offboarding.ts`, `lib/offboarding.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 3, 5, 6):
  - `type DeviceDisposition = "return_to_stock" | "leave_with_customer"`
  - `interface DeviceChoice { deviceId: string; disposition: DeviceDisposition }`
  - `type ArchivedStatus = "active" | "archived"`
  - `deriveArchivedStatus(archivedAt: Date | string | null | undefined): ArchivedStatus`
  - `interface OffboardSummary { returnedToStock: number; leftWithCustomer: number; revokedKeys: number; sweptAllocations: number; frozenCreditsAvailable: number; frozenCreditsHeld: number }`
  - `buildOffboardMetadata(summary: OffboardSummary, note: string | null): Record<string, unknown>`
  - `partitionDispositions(choices: DeviceChoice[]): { returnIds: string[]; leaveIds: string[] }`

- [ ] **Step 1: Write failing tests (`lib/offboarding.test.ts`)**

```ts
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
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run lib/offboarding.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/offboarding.ts`**

```ts
// Pure offboarding logic (DB-free, unit-tested). The server action in
// lib/actions/offboarding.ts applies the DB mutations these helpers describe.

export type DeviceDisposition = "return_to_stock" | "leave_with_customer";

export interface DeviceChoice {
  deviceId: string;
  disposition: DeviceDisposition;
}

export type ArchivedStatus = "active" | "archived";

export function deriveArchivedStatus(
  archivedAt: Date | string | null | undefined,
): ArchivedStatus {
  return archivedAt ? "archived" : "active";
}

export function partitionDispositions(choices: DeviceChoice[]): {
  returnIds: string[];
  leaveIds: string[];
} {
  const returnIds: string[] = [];
  const leaveIds: string[] = [];
  for (const c of choices) {
    if (c.disposition === "return_to_stock") returnIds.push(c.deviceId);
    else leaveIds.push(c.deviceId);
  }
  return { returnIds, leaveIds };
}

export interface OffboardSummary {
  returnedToStock: number;
  leftWithCustomer: number;
  revokedKeys: number;
  sweptAllocations: number;
  frozenCreditsAvailable: number;
  frozenCreditsHeld: number;
}

export function buildOffboardMetadata(
  summary: OffboardSummary,
  note: string | null,
): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...summary };
  if (note) meta.note = note;
  return meta;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/offboarding.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/offboarding.ts lib/offboarding.test.ts
git commit -m "feat(offboarding): pure disposition/status/summary helpers"
```

---

### Task 3: Data-layer archive support (device return + registry retire + queries)

**Files:**
- Modify: `lib/factory-registry.ts` (new `retireRegistryForDevice`, `returnDeviceToStock`)
- Modify: `lib/data.ts` (`loadAllOrgs` archived filter; `getCustomerDetail` exposes `archivedAt`/`archivedNote`; `getTenantSummaries`/`getAllDevices` exclusion; org device list helper)

**Interfaces:**
- Consumes: Task 1 columns; Task 2 types.
- Produces (used by Tasks 4, 5, 6):
  - `returnDeviceToStock(deviceId: string): Promise<{ ok: boolean; serial: string | null; deviceName: string | null }>` — deletes the device row and reverts its registry row (if any) to `manufactured`, in one `dbTx` transaction. Idempotent: a missing device returns `{ ok: true, serial: null, deviceName: null }`.
  - `retireDeviceWithCustomer(deviceId: string): Promise<{ ok: boolean; serial: string | null; deviceName: string | null }>` — sets device `status:"paused"` and its registry row to `retired` (keeps `deviceId`). Idempotent.
  - `loadAllOrgs(opts?: { includeArchived?: boolean }): Promise<OrgBundle[]>` — excludes archived orgs unless `includeArchived`.
  - `getCustomerDetail` result gains `archivedAt: string | null` and `archivedNote: string | null` on its `tenant` (or a sibling field).
  - `getOrgDevicesForOffboard(organizationId: string): Promise<{ id: string; name: string; serial: string | null; status: string }[]>`

- [ ] **Step 1: Add device-disposition helpers to `lib/factory-registry.ts`**

Use the file's existing `dbTx`, `device as deviceTable`, `factoryDevice`, `eq`, `and`, `sql`, `AUDIT`, `recordAudit`, `isUniqueViolation` imports; add any missing (`isNull`). Append:

```ts
/**
 * Offboarding "return to stock": delete the device row (commands cascade; the
 * key hash dies with it) and, if the device carried a serial, revert that
 * registry row to `manufactured` clearing all allocation/claim linkage — the
 * serial becomes re-allocatable. One transaction; idempotent (missing device →
 * ok with null serial). Audit is recorded by the caller (needs the org id).
 */
export async function returnDeviceToStock(
  deviceId: string,
): Promise<{ ok: boolean; serial: string | null; deviceName: string | null }> {
  return dbTx.transaction(async (tx) => {
    const [dev] = await tx
      .select({ id: deviceTable.id, name: deviceTable.name, serial: deviceTable.serial })
      .from(deviceTable)
      .where(eq(deviceTable.id, deviceId))
      .for("update");
    if (!dev) return { ok: true, serial: null, deviceName: null };

    if (dev.serial) {
      await tx
        .update(factoryDevice)
        .set({
          status: "manufactured",
          allocatedOrganizationId: null,
          allocatedStoreId: null,
          deviceId: null,
          claimedAt: null,
        })
        .where(eq(factoryDevice.deviceId, deviceId));
    }
    await tx.delete(deviceTable).where(eq(deviceTable.id, deviceId));
    return { ok: true, serial: dev.serial, deviceName: dev.name };
  });
}

/**
 * Offboarding "leave with customer": pause the device and mark its registry row
 * `retired` (deviceId kept, for traceability). Idempotent.
 */
export async function retireDeviceWithCustomer(
  deviceId: string,
): Promise<{ ok: boolean; serial: string | null; deviceName: string | null }> {
  return dbTx.transaction(async (tx) => {
    const [dev] = await tx
      .select({ id: deviceTable.id, name: deviceTable.name, serial: deviceTable.serial })
      .from(deviceTable)
      .where(eq(deviceTable.id, deviceId))
      .for("update");
    if (!dev) return { ok: true, serial: null, deviceName: null };

    await tx.update(deviceTable).set({ status: "paused" }).where(eq(deviceTable.id, deviceId));
    if (dev.serial) {
      await tx
        .update(factoryDevice)
        .set({ status: "retired" })
        .where(eq(factoryDevice.deviceId, deviceId));
    }
    return { ok: true, serial: dev.serial, deviceName: dev.name };
  });
}
```

- [ ] **Step 2: Add `getOrgDevicesForOffboard` to `lib/data.ts`**

Near `getCustomerDetail`, add (uses existing `deviceTable`, `eq`, `db`):

```ts
export async function getOrgDevicesForOffboard(
  organizationId: string,
): Promise<{ id: string; name: string; serial: string | null; status: string }[]> {
  return db
    .select({
      id: deviceTable.id,
      name: deviceTable.name,
      serial: deviceTable.serial,
      status: deviceTable.status,
    })
    .from(deviceTable)
    .where(eq(deviceTable.organizationId, organizationId))
    .orderBy(deviceTable.name);
}
```

- [ ] **Step 3: Exclude archived orgs in `loadAllOrgs`**

`lib/data.ts` `loadAllOrgs` currently selects all org ids. Replace with an archived-aware version. The archive flag lives on `tenantSettings`, so left-join it:

```ts
async function loadAllOrgs(opts?: { includeArchived?: boolean }): Promise<OrgBundle[]> {
  const rows = await db
    .select({ id: orgTable.id, archivedAt: settingsTable.archivedAt })
    .from(orgTable)
    .leftJoin(settingsTable, eq(settingsTable.organizationId, orgTable.id));
  const ids = rows
    .filter((r) => opts?.includeArchived || r.archivedAt === null)
    .map((r) => r.id);
  const bundles = await Promise.all(ids.map((id) => loadOrg(id)));
  return bundles.filter((b): b is OrgBundle => b !== null);
}
```

Confirm the settings table is imported as `settingsTable` in `lib/data.ts` (it is used inside `loadOrg`). `getTenantSummaries()` and `getAllDevices()` call `loadAllOrgs()` with no args, so they now exclude archived orgs automatically — no change needed there.

- [ ] **Step 4: Expose archive fields on `getCustomerDetail`**

In `loadOrg`, the `settings` row is already selected. Ensure `getCustomerDetail`'s returned `tenant` (built by `buildTenant`) or the detail object carries `archivedAt`/`archivedNote`. Add to the `CustomerDetail` return: read them off the loaded settings bundle and include `archivedAt: b.settings?.archivedAt ? b.settings.archivedAt.toISOString() : null` and `archivedNote: b.settings?.archivedNote ?? null` on the returned object. (Match the exact `CustomerDetail` shape in the file; add the two fields to its TS type.)

- [ ] **Step 5: Verify + commit**

Run: `npm run build && npm test` — Expected: clean (no new unit tests here; DB helpers are exercised by Task 7 live QA).

```bash
git add lib/factory-registry.ts lib/data.ts
git commit -m "feat(offboarding): device return-to-stock/retire helpers + archived-aware org queries"
```

---

### Task 4: Offboarding + restore server actions

**Files:**
- Create: `lib/actions/offboarding.ts`

**Interfaces:**
- Consumes: Task 2 (`DeviceChoice`, `partitionDispositions`, `buildOffboardMetadata`, `OffboardSummary`), Task 3 (`returnDeviceToStock`, `retireDeviceWithCustomer`), `deallocateSerials` (existing, `lib/factory-registry.ts`), `getBalance` (`lib/credits.ts`), `requirePlatformAdmin` (`lib/session.ts`), `AUDIT`/`recordAudit`, `db`.
- Produces (used by Task 5/6 UI):
  - `offboardCustomerAction(organizationId: string, choices: DeviceChoice[], note: string | null): Promise<{ ok: boolean; error?: string; summary?: OffboardSummary }>`
  - `restoreCustomerAction(organizationId: string): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Create `lib/actions/offboarding.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  tenantSettings,
  apiKey as apiKeyTable,
  invitation as invitationTable,
} from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { AUDIT, recordAudit } from "@/lib/audit";
import { getBalance } from "@/lib/credits";
import {
  returnDeviceToStock,
  retireDeviceWithCustomer,
  deallocateSerials,
} from "@/lib/factory-registry";
import {
  partitionDispositions,
  buildOffboardMetadata,
  type DeviceChoice,
  type OffboardSummary,
} from "@/lib/offboarding";

export async function offboardCustomerAction(
  organizationId: string,
  choices: DeviceChoice[],
  note: string | null,
): Promise<{ ok: boolean; error?: string; summary?: OffboardSummary }> {
  const ctx = await requirePlatformAdmin();

  const { returnIds, leaveIds } = partitionDispositions(choices);

  // Step 1: device dispositions (each helper is idempotent).
  let returnedToStock = 0;
  for (const id of returnIds) {
    const r = await returnDeviceToStock(id);
    if (r.ok && r.deviceName !== null) {
      returnedToStock++;
      await recordAudit({
        organizationId,
        actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
        action: AUDIT.deviceReturnedToStock,
        target: { type: "device", id },
        metadata: { serial: r.serial, deviceName: r.deviceName },
      });
    }
  }
  let leftWithCustomer = 0;
  for (const id of leaveIds) {
    const r = await retireDeviceWithCustomer(id);
    if (r.ok && r.deviceName !== null) {
      leftWithCustomer++;
      await recordAudit({
        organizationId,
        actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
        action: AUDIT.deviceLeftWithCustomer,
        target: { type: "device", id },
        metadata: { serial: r.serial, deviceName: r.deviceName },
      });
    }
  }

  // Allocation sweep: any still-allocated serials for this org → manufactured.
  const orgAllocatedSerials = await db
    .select({ serial: (await import("@/lib/db/schema")).factoryDevice.serial })
    .from((await import("@/lib/db/schema")).factoryDevice)
    .where(
      and(
        eq((await import("@/lib/db/schema")).factoryDevice.allocatedOrganizationId, organizationId),
        eq((await import("@/lib/db/schema")).factoryDevice.status, "allocated"),
      ),
    );
  const sweep = await deallocateSerials(orgAllocatedSerials.map((r) => r.serial));

  // Step 2: access shutdown — revoke keys, cancel pending invitations.
  const revoked = await db
    .update(apiKeyTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeyTable.organizationId, organizationId), isNull(apiKeyTable.revokedAt)))
    .returning({ id: apiKeyTable.id });
  await db
    .update(invitationTable)
    .set({ status: "canceled" })
    .where(and(eq(invitationTable.organizationId, organizationId), eq(invitationTable.status, "pending")));

  // Step 3: freeze credits (read only) + archive stamp (LAST).
  const balance = await getBalance(organizationId);
  const summary: OffboardSummary = {
    returnedToStock,
    leftWithCustomer,
    revokedKeys: revoked.length,
    sweptAllocations: sweep.updated,
    frozenCreditsAvailable: balance.available,
    frozenCreditsHeld: balance.held,
  };

  await db
    .update(tenantSettings)
    .set({ archivedAt: new Date(), archivedNote: note })
    .where(eq(tenantSettings.organizationId, organizationId));

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.orgArchived,
    target: { type: "organization", id: organizationId },
    metadata: buildOffboardMetadata(summary, note),
  });

  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${organizationId}`);
  return { ok: true, summary };
}

export async function restoreCustomerAction(
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePlatformAdmin();
  await db
    .update(tenantSettings)
    .set({ archivedAt: null, archivedNote: null })
    .where(eq(tenantSettings.organizationId, organizationId));
  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.orgRestored,
    target: { type: "organization", id: organizationId },
  });
  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${organizationId}`);
  return { ok: true };
}
```

- [ ] **Step 2: Clean up the dynamic-import smell**

The `await import(...)` inline calls above are a placeholder to avoid a top-of-file assumption about the export name — REPLACE them: add `factoryDevice` to the static import from `@/lib/db/schema` at the top, and use it directly in the sweep query. `invitation.status` is a plain `text` column (no enum constraint, default `"pending"`) — `"canceled"` is a safe free-text value matching Better Auth's org-plugin convention; keep it. Verify `getBalance` returns `{ available, held }` (it does per `lib/credits.ts`).

- [ ] **Step 3: Verify + commit**

Run: `npm run build && npm test` — Expected: clean.

```bash
git add lib/actions/offboarding.ts
git commit -m "feat(offboarding): offboard + restore server actions (idempotent, archive-last)"
```

---

### Task 5: Access gate (requireTenant) + archived tenant notice

**Files:**
- Modify: `lib/session.ts` (`getContext` selects archive flag; `requireTenant` gate)
- Create: `app/(tenant)/archived/page.tsx` (or a notice route the redirect targets)

**Interfaces:**
- Consumes: Task 1 columns; Task 2 `deriveArchivedStatus`.
- Produces: `getContext` returns only non-archived orgs in `organizations` (archived memberships filtered out); `requireTenant` redirects a member whose active org is archived.

- [ ] **Step 1: Filter archived orgs in `getContext`**

In `lib/session.ts` `getContext`, the org query joins `member`→`organization`. Left-join `tenantSettings` and drop archived orgs so an archived org never becomes active or appears in the switcher:

```ts
import { member, organization, tenantSettings } from "./db/schema";
// ...
  const organizations = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
      archivedAt: tenantSettings.archivedAt,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .leftJoin(tenantSettings, eq(tenantSettings.organizationId, organization.id))
    .where(eq(member.userId, session.user.id));

  const activeOrgs = organizations.filter((o) => o.archivedAt === null);
```

Then build `OrgRef[]` from `activeOrgs` (strip `archivedAt`), and compute `activeOrganizationId` from `activeOrgs` — if the session's `activeOrganizationId` points at an org NOT in `activeOrgs`, fall back to `activeOrgs[0]?.id ?? null`.

- [ ] **Step 2: Verify the gate in `requireTenant`**

With archived orgs filtered from `getContext`, an archived-only member gets `activeOrganizationId === null`, so the existing `requireTenant` redirect fires. For a non-admin with no active org, redirect to a notice instead of `/login` (a login loop). Change the non-admin branch:

```ts
  if (!ctx.activeOrganizationId) {
    redirect(ctx.user.role === "platform_admin" ? "/admin" : "/archived");
  }
```

- [ ] **Step 3: Create the archived notice page `app/(tenant)/archived/page.tsx`**

A minimal server component (no tenant chrome — it renders for someone with no active org). Follow the app's card/typography:

```tsx
import { getContext } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function ArchivedNoticePage() {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  // If they regained an active (non-archived) org, send them in.
  if (ctx.activeOrganizationId) redirect("/tenant");
  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="font-display text-2xl font-bold">Account archived</h1>
      <p className="text-sm text-muted-foreground">
        This organization has been archived and is no longer active. If you think
        this is a mistake, contact your Maratus account manager.
      </p>
    </div>
  );
}
```

Confirm `/archived` sits OUTSIDE the tenant layout's `requireTenant` gate (if the `(tenant)` group layout calls `requireTenant`, place the notice at `app/archived/page.tsx` instead so it doesn't recurse into the redirect). Choose the path that avoids a redirect loop and update the `requireTenant` target to match.

- [ ] **Step 4: Verify + commit**

Run: `npm run build && npm test` — Expected: clean.

```bash
git add lib/session.ts "app/(tenant)/archived" app/archived 2>/dev/null; git add -A
git commit -m "feat(offboarding): gate archived orgs out of tenant access + archived notice"
```

---

### Task 6: Admin UI — offboard wizard, restore, Active/Archived filter, read-only archived detail

**Files:**
- Create: `components/customers/offboard-wizard.tsx` (client), `components/customers/restore-customer-button.tsx` (client)
- Modify: `app/(admin)/admin/customers/page.tsx` (segment filter), `lib/data.ts` (`getTenantSummaries` includes archived flag + optional includeArchived), `app/(admin)/admin/customers/[tenantId]/page.tsx` (offboard button, read-only when archived, offboarding-summary card)

**Interfaces:**
- Consumes: Task 2 (`DeviceChoice`, `deriveArchivedStatus`), Task 3 (`getOrgDevicesForOffboard`, `getCustomerDetail` archive fields), Task 4 actions.
- Produces: UI only.

- [ ] **Step 1: Summaries carry the archived flag + optional inclusion**

In `lib/data.ts`, `getTenantSummaries()` maps `loadAllOrgs()`. Add an `includeArchived` passthrough and surface `archivedAt` on each `TenantSummary` (add `archivedAt: string | null` to the type; set it from the bundle settings). Signature: `getTenantSummaries(opts?: { includeArchived?: boolean })` → forwards to `loadAllOrgs(opts)`. Default (no opts) stays archived-excluded.

- [ ] **Step 2: Customers list segment filter**

In `app/(admin)/admin/customers/page.tsx`, read `searchParams` (`view` = `active|archived|all`, default `active`; Next 16 `searchParams` is a Promise — await it), call `getTenantSummaries({ includeArchived: view !== "active" })`, and for `archived`/`all` filter the rows client-appropriately: `active` → non-archived (default query already excludes), `archived` → only `archivedAt !== null`, `all` → everything. Render a 3-item segment control (links to `?view=…`, radix-nova styling; match the inventory page's filter placement). Archived rows: muted "Archived" badge + archive date next to the name; keep the row link working.

- [ ] **Step 3: Offboard wizard component `components/customers/offboard-wizard.tsx`**

A client dialog opened from the customer detail page. Props: `organizationId: string`, `organizationName: string`, `devices: { id: string; name: string; serial: string | null; status: string }[]`. State: per-device disposition map (default `return_to_stock`), a note string, a typed-confirmation string that must equal `organizationName` to enable the confirm button, and busy. On confirm call `offboardCustomerAction(organizationId, choices, note || null)`; toast the summary (`Returned N to stock, left M with customer, revoked K keys`) on success and `router.refresh()`; toast `res.error` otherwise. Include an "Apply to all" control (two buttons: all→return, all→leave). Use shadcn `Dialog`, `Select`/radio group per device, `Input`, `Button`, `sonner`. Follow the inventory-table dialog patterns (reset state on close, disable confirm while busy). Devices list can be empty → wizard still archives (Step 3 only).

- [ ] **Step 4: Restore button `components/customers/restore-customer-button.tsx`**

Client component: a `Button` opening a confirm `Dialog` stating what does NOT come back (revoked API keys, device dispositions, cancelled invitations — verbatim from the spec's Restore section). On confirm call `restoreCustomerAction(organizationId)`, toast + `router.refresh()`.

- [ ] **Step 5: Wire the customer detail page**

In `app/(admin)/admin/customers/[tenantId]/page.tsx`:
- Read `archivedAt`/`archivedNote` from `getCustomerDetail`; compute `deriveArchivedStatus`.
- When ARCHIVED: hide/disable all mutating UI (`GrantCreditsForm`, `AddBranchDialog`, `ProvisionDeviceDialog`, `DeviceRowActions`); show a top "Archived on <date> — <note>" banner; render an "Offboarding summary" card from the latest `org.archived` audit metadata (read via `getOrgAuditLog`, find the newest `org.archived` entry, show returned/left/revoked/swept/frozen-credits); render `<RestoreCustomerButton organizationId=… />`.
- When ACTIVE: render an "Offboard customer…" button (destructive styling) in a footer/danger zone that mounts `<OffboardWizard organizationId=… organizationName=… devices={await getOrgDevicesForOffboard(tenantId)} />`.

- [ ] **Step 6: Verify + commit**

Run: `npm run build && npm run lint && npm test` — Expected: clean (lint: the pre-existing ~16-error baseline is unchanged; report only NEW errors).

```bash
git add "app/(admin)/admin/customers" components/customers lib/data.ts
git commit -m "feat(offboarding): admin offboard wizard, restore, archived filter + read-only detail"
```

---

### Task 7: End-to-end verification (dev DB)

**Files:** none (may add throwaway scripts under `/Users/eren/.claude/jobs/72de44a0/tmp/`).

- [ ] **Step 1: Full checks**

Run: `npm run build && npm test && npm run lint` — Expected: green (lint baseline unchanged).

- [ ] **Step 2: Live offboard → restore round-trip (dev DB)**

`npm run db:migrate` against the dev DB (applies 0031). Then via tsx scripts (import `@/lib/db/load-env` first; `NODE_PATH=/Users/eren/Projects/maratus-admin/node_modules` if resolution fails) and/or the dev server + curl:
1. Pick Roastwell Coffee; snapshot its devices, an allocated factory serial (allocate one if none), an active API key, a pending invitation.
2. Call `offboardCustomerAction(orgId, choices, "QA test")` with a mix of return/leave dispositions. Assert: returned devices' rows gone + their registry rows `manufactured`; left devices `paused` + registry `retired`; swept allocation → `manufactured`; API keys `revokedAt` set; invitation `canceled`; `tenantSettings.archivedAt` set; an `org.archived` audit row with the summary metadata.
3. Assert exclusion: `getTenantSummaries()` no longer lists Roastwell; `getTenantSummaries({ includeArchived: true })` does.
4. Assert the gate: hit `/tenant` as dana (dev server) → redirected to the archived notice (not a login loop).
5. Call `restoreCustomerAction(orgId)`. Assert `archivedAt` null, `org.restored` audited, Roastwell back in `getTenantSummaries()`, dana can reach `/tenant` again. (Devices/keys deliberately NOT restored.)
6. Re-run `offboardCustomerAction` twice back-to-back to prove idempotency (second run: no crash, device helpers no-op, archive re-stamped).
7. Restore again to leave the seed usable; clean up any QA-only allocation rows.

- [ ] **Step 3: Ship**

```bash
git push origin main
```
Prod: `npm run db:migrate` against Neon (0031 — additive, safe either order), `vercel deploy --prod --yes`, then smoke: `/admin/customers?view=archived` route serves (307→login logged out), `/`/`/api/health` 200.

---

## Self-review notes (already applied)

- **Spec coverage:** archive columns (T1), pure logic (T2), device return/retire + archived-aware queries + sweep source (T3), 3-step idempotent offboard + restore + credit freeze + audit summary (T4), requireTenant gate + notice (T5), wizard + restore + filter + read-only archived detail + KPI exclusion via loadAllOrgs (T6), verification incl. idempotency + gate + restore (T7). Enforcement "claim endpoint: no change" is covered by the sweep (T4) — no task needed. "v1 API guard: no change (YAGNI)" — intentionally no task.
- **Idempotency:** `archivedAt` written last (T4 Step 1); device helpers no-op on missing rows (T3); key-revoke/invite-cancel are `WHERE`-guarded no-ops on re-run.
- **Type consistency:** `DeviceChoice`/`DeviceDisposition`/`OffboardSummary` defined T2, consumed T4/T6; `returnDeviceToStock`/`retireDeviceWithCustomer` defined T3, consumed T4; actions defined T4, consumed T6.
- **Open item flagged for implementer (T4 Step 2):** confirm the `invitation.status` enum's exact cancel member and the `factoryDevice` static import — both called out in the task, not left implicit.

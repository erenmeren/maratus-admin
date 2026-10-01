# Store Deletion & Unassigned Device Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenants and platform admins can delete a store; its devices drop into an org-level "Unassigned devices" pool on `/tenant/stores` from which they can be assigned to any store.

**Architecture:** No schema change — `device.storeId` and `factoryDevice.allocatedStoreId` FKs are already `onDelete: "set null"`. The work is app-layer: one new audit constant, a pool concept in the `lib/data.ts` view-model (`storeId IS NULL AND claimedAt IS NOT NULL`), three server actions (`deleteStore`, `deleteStoreForOrg`, tenant `assignDeviceToStore`), and UI on the tenant stores pages + admin customer detail.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Drizzle/Neon, shadcn/ui (radix-nova), vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-store-deletion-unassigned-pool-design.md`

## Global Constraints

- Repo: `/Users/eren/Projects/maratus-admin`, branch `feat/store-deletion` off `main` (created in Task 1).
- ⚠️ `.env.local` points at PRODUCTION Neon. `npm run db:seed` is FORBIDDEN. No migration is needed and none may be created (`npm run db:generate`/`db:push` must NOT run).
- Tests: `npm test` (vitest). Type gate: `npx tsc --noEmit`. Both must pass at the end of every task.
- Pool membership is exactly `storeId === null && claimedAt !== null` — unclaimed provisioned devices (claimedAt null) stay OUT of the pool.
- Authorization: tenant actions = `requireTenant()` + owner/admin membership check (copy the exact pattern from `createStore`); admin actions = `requirePlatformAdmin()` + `isOrgArchived` guard.
- Audit: store deletion records `AUDIT.storeDeleted` with metadata `{ name, unassignedDeviceCount, disarmedAllocationCount }`; assignment reuses existing `AUDIT.deviceReassigned` with `{ storeId }`.
- UI copy is English, components are shadcn (`Dialog`, not AlertDialog — the repo has no alert-dialog). Follow the `DeviceRowActions` client pattern (pending state + `toast` + `router.refresh()`).
- Dashboard chrome: pages return fragments; use existing `PageSection`/`Card` primitives; no page re-padding.

---

### Task 1: Branch + `store.deleted` audit constant and label (TDD)

**Files:**
- Modify: `lib/audit.ts` (AUDIT map, after `storeUpdated`)
- Modify: `lib/audit-labels.ts` (AUDIT_LABELS map, after `"store.updated"`)
- Test: `lib/audit-labels.test.ts` (existing completeness test is the failing test)

**Interfaces:**
- Consumes: nothing.
- Produces: `AUDIT.storeDeleted` (value `"store.deleted"`) — Task 3 records it.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/eren/Projects/maratus-admin
git checkout main && git pull && git checkout -b feat/store-deletion
```

- [ ] **Step 2: Write the failing state — add the constant only**

In `lib/audit.ts`, after the line `storeUpdated: "store.updated",` add:

```ts
  storeDeleted: "store.deleted",
```

- [ ] **Step 3: Run the completeness test to verify it fails**

Run: `npx vitest run lib/audit-labels.test.ts`
Expected: FAIL — `AUDIT_LABELS completeness` reports `missing label for "store.deleted"`.

- [ ] **Step 4: Add the label**

In `lib/audit-labels.ts`, after the line `"store.updated": "Store updated",` add:

```ts
  "store.deleted": "Store deleted",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/audit-labels.test.ts`
Expected: PASS (all suites in the file).

- [ ] **Step 6: Commit**

```bash
git add lib/audit.ts lib/audit-labels.ts
git commit -m "feat(audit): store.deleted action + label"
```

---

### Task 2: Data layer — unassigned pool + aggregate fixes + impact counts

**Files:**
- Modify: `lib/types.ts` (Tenant interface, ~line 34)
- Modify: `lib/data.ts` (`buildTenant` ~246, `summarize` ~303, `getTenantOverview` ~399, `getCustomerDetail` ~694, new exports at the end)

**Interfaces:**
- Consumes: `AUDIT` unchanged; existing `mapDevice`, `effectiveDeviceStatus`, `OrgBundle`.
- Produces (later tasks rely on these exact names):
  - `Tenant.unassignedDevices: Device[]` (types.ts)
  - `getTenantUnassignedDevices(organizationId: string): Promise<Device[]>`
  - `getArmedAllocationCountByStore(organizationId: string): Promise<Record<string, number>>`

- [ ] **Step 1: Extend the Tenant type**

In `lib/types.ts`, inside `interface Tenant`, after `stores: Store[];` add:

```ts
  /** Claimed devices with no store (their store was deleted / they were unassigned). */
  unassignedDevices: Device[];
```

- [ ] **Step 2: Populate the pool in `buildTenant`**

In `lib/data.ts` `buildTenant`, after the `const stores: Store[] = ...` block, add:

```ts
  // Claimed but storeless (store deleted or admin-unassigned). Unclaimed
  // provisioned devices are also storeless by design — keep them out.
  const unassignedDevices: Device[] = b.devices
    .filter((d) => d.storeId === null && d.claimedAt !== null)
    .map((d) => mapDevice(d, b.org.id, todayBy, monthBy));
```

and add `unassignedDevices,` to the returned object (after `stores,`).

- [ ] **Step 3: Include the pool in every all-devices aggregate**

Three call sites currently compute `tenant.stores.flatMap((s) => s.devices)`:

`summarize` (~line 303):

```ts
  const allDevices = [
    ...tenant.stores.flatMap((s) => s.devices),
    ...tenant.unassignedDevices,
  ];
```

`getTenantOverview` (~line 399):

```ts
  const devices = [
    ...tenant.stores.flatMap((s) => s.devices),
    ...tenant.unassignedDevices,
  ];
```

`getCustomerDetail` (~line 694) — append pool devices with `storeName: "—"`, keeping the same effective-status mapping:

```ts
  const devices: DeviceRow[] = [
    ...tenant.stores.flatMap((store) =>
      store.devices.map((d) => ({
        ...d,
        status: effectiveDeviceStatus(d.status, d.lastSeenAt ? new Date(d.lastSeenAt) : null, now),
        tenantName: tenant.name,
        storeName: store.name,
      })),
    ),
    ...tenant.unassignedDevices.map((d) => ({
      ...d,
      status: effectiveDeviceStatus(d.status, d.lastSeenAt ? new Date(d.lastSeenAt) : null, now),
      tenantName: tenant.name,
      storeName: "—",
    })),
  ];
```

- [ ] **Step 4: Add the two new data functions**

At the end of `lib/data.ts` (before the re-export line `export { claimDevice, getUnclaimedDevices } from "./documents";`), add — extend the existing `drizzle-orm` import with `isNotNull` if it isn't already imported, and the schema import with `factoryDevice`:

```ts
/** The org's unassigned pool (claimed devices whose store was deleted). */
export async function getTenantUnassignedDevices(
  organizationId: string,
): Promise<Device[]> {
  const tenant = await getTenant(organizationId);
  return tenant.unassignedDevices;
}

/**
 * Armed zero-touch allocations per store: factory serials allocated to a
 * store but not yet claimed. Deleting the store disarms them (FK set-null),
 * so delete dialogs surface this count as a warning.
 */
export async function getArmedAllocationCountByStore(
  organizationId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ storeId: factoryDevice.allocatedStoreId, n: count() })
    .from(factoryDevice)
    .where(
      and(
        eq(factoryDevice.allocatedOrganizationId, organizationId),
        eq(factoryDevice.status, "allocated"),
        isNotNull(factoryDevice.allocatedStoreId),
      ),
    )
    .groupBy(factoryDevice.allocatedStoreId);
  const out: Record<string, number> = {};
  for (const r of rows) if (r.storeId) out[r.storeId] = r.n;
  return out;
}
```

(`count` is likely already imported from drizzle-orm in data.ts — check and extend the import only if missing.)

- [ ] **Step 5: Type-check and test**

Run: `npx tsc --noEmit && npm test`
Expected: both clean. If `tsc` reports OTHER files constructing `Tenant` literals without `unassignedDevices`, fix each by adding `unassignedDevices: []` — but `buildTenant` is expected to be the only constructor.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/data.ts
git commit -m "feat(data): unassigned device pool + armed-allocation impact counts"
```

---

### Task 3: Server actions — deleteStore / deleteStoreForOrg / assignDeviceToStore

**Files:**
- Modify: `lib/actions/stores.ts` (new delete actions + shared helper)
- Modify: `lib/actions/devices.ts` (new tenant-scoped assign action)

**Interfaces:**
- Consumes: `AUDIT.storeDeleted` (Task 1); existing `requireTenant`, `requirePlatformAdmin`, `isOrgArchived`, `recordAudit`, `ActionResult` (devices.ts).
- Produces (Task 4/5 call these exact signatures):
  - `deleteStore(storeId: string): Promise<{ ok: boolean; error?: string }>`
  - `deleteStoreForOrg(organizationId: string, storeId: string): Promise<{ ok: boolean; error?: string }>`
  - `assignDeviceToStore(deviceId: string, storeId: string): Promise<ActionResult>`

- [ ] **Step 1: Add the delete actions to `lib/actions/stores.ts`**

Extend imports: add `count` to the `drizzle-orm` import, and `device as deviceTable, factoryDevice` to the schema import. Then append:

```ts
export interface DeleteStoreResult {
  ok: boolean;
  error?: string;
}

// Shared body for both roles. Deleting the row nulls device.storeId and
// factoryDevice.allocatedStoreId via the FKs' onDelete: "set null" — devices
// drop into the tenant's Unassigned pool; armed allocations disarm.
async function performStoreDelete(
  organizationId: string,
  storeId: string,
  actor: { type: "user"; id: string; label: string },
): Promise<DeleteStoreResult> {
  const [existing] = await db
    .select({ id: storeTable.id, name: storeTable.name })
    .from(storeTable)
    .where(and(eq(storeTable.id, storeId), eq(storeTable.organizationId, organizationId)))
    .limit(1);
  if (!existing) return { ok: false, error: "Store not found." };

  const [{ n: unassignedDeviceCount }] = await db
    .select({ n: count() })
    .from(deviceTable)
    .where(eq(deviceTable.storeId, storeId));
  const [{ n: disarmedAllocationCount }] = await db
    .select({ n: count() })
    .from(factoryDevice)
    .where(and(eq(factoryDevice.allocatedStoreId, storeId), eq(factoryDevice.status, "allocated")));

  await db
    .delete(storeTable)
    .where(and(eq(storeTable.id, storeId), eq(storeTable.organizationId, organizationId)));

  await recordAudit({
    organizationId,
    actor,
    action: AUDIT.storeDeleted,
    target: { type: "store", id: storeId },
    metadata: { name: existing.name, unassignedDeviceCount, disarmedAllocationCount },
  });
  return { ok: true };
}

/** Delete a store (tenant owner/admin). Its devices move to the Unassigned pool. */
export async function deleteStore(storeId: string): Promise<DeleteStoreResult> {
  const { ctx, organizationId } = await requireTenant();

  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "You don't have permission to delete stores." };
  }

  const result = await performStoreDelete(organizationId, storeId, {
    type: "user",
    id: ctx.user.id,
    label: ctx.user.email,
  });
  if (!result.ok) return result;

  revalidatePath("/tenant/stores");
  revalidatePath("/tenant");
  return result;
}

/** Platform-admin variant (parity with createStoreForOrg). */
export async function deleteStoreForOrg(
  organizationId: string,
  storeId: string,
): Promise<DeleteStoreResult> {
  const ctx = await requirePlatformAdmin();

  const [org] = await db
    .select({ id: orgTable.id })
    .from(orgTable)
    .where(eq(orgTable.id, organizationId))
    .limit(1);
  if (!org) return { ok: false, error: "Customer not found." };
  if (await isOrgArchived(organizationId)) {
    return { ok: false, error: "Customer is archived." };
  }

  const result = await performStoreDelete(organizationId, storeId, {
    type: "user",
    id: ctx.user.id,
    label: ctx.user.email,
  });
  if (!result.ok) return result;

  revalidatePath(`/admin/customers/${organizationId}`);
  revalidatePath("/admin");
  return result;
}
```

- [ ] **Step 2: Add the tenant assign action to `lib/actions/devices.ts`**

Append (imports for `storeTable`, `requireTenant`, `AUDIT`, `recordAudit` already exist in this file — verify, extend only if missing):

```ts
/**
 * Assign a pool (or any same-org) device to a store — the tenant-scoped
 * sibling of the admin-only reassignDevice. Owner/admin only.
 */
export async function assignDeviceToStore(
  deviceId: string,
  storeId: string,
): Promise<ActionResult> {
  const { ctx, organizationId } = await requireTenant();

  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "You don't have permission to manage devices." };
  }

  const [device] = await db
    .select({ id: deviceTable.id, organizationId: deviceTable.organizationId })
    .from(deviceTable)
    .where(eq(deviceTable.id, deviceId))
    .limit(1);
  if (!device || device.organizationId !== organizationId) {
    return { ok: false, error: "Device not found." };
  }

  const [target] = await db
    .select({ id: storeTable.id })
    .from(storeTable)
    .where(and(eq(storeTable.id, storeId), eq(storeTable.organizationId, organizationId)))
    .limit(1);
  if (!target) return { ok: false, error: "Store not found." };

  await db.update(deviceTable).set({ storeId }).where(eq(deviceTable.id, deviceId));

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.deviceReassigned,
    target: { type: "device", id: deviceId },
    metadata: { storeId },
  });

  revalidatePath("/tenant/stores");
  revalidatePath(`/tenant/stores/${storeId}`);
  revalidatePath("/tenant");
  return { ok: true };
}
```

Note: match the file's actual local names — if the file imports the device table as `device` rather than `deviceTable`, use the file's name (read the file first; `reassignDevice` shows the local naming).

- [ ] **Step 3: Type-check and test**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/stores.ts lib/actions/devices.ts
git commit -m "feat(stores): deleteStore/deleteStoreForOrg + tenant assignDeviceToStore"
```

---

### Task 4: Tenant UI — unassigned pool section + store delete button

**Files:**
- Create: `components/delete-store-dialog.tsx` (shared presentational confirm dialog)
- Create: `components/store-delete-button.tsx` (tenant wiring)
- Create: `components/unassigned-devices.tsx` (pool card)
- Modify: `app/(tenant)/tenant/stores/page.tsx` (render pool section)
- Modify: `app/(tenant)/tenant/stores/[storeId]/page.tsx` (render delete button next to `StoreEditButton`)

**Interfaces:**
- Consumes: `deleteStore`, `assignDeviceToStore` (Task 3); `getTenantUnassignedDevices`, `getArmedAllocationCountByStore` (Task 2); existing `StatusDot`, `PageSection`, shadcn `Dialog`/`Select`, `toast` from `sonner`.
- Produces: `DeleteStoreDialog` props `{ storeName: string; deviceCount: number; armedCount: number; open: boolean; onOpenChange: (o: boolean) => void; pending: boolean; onConfirm: () => void }` — Task 5 reuses it.

- [ ] **Step 1: Create `components/delete-store-dialog.tsx`**

```tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Shared confirm dialog for store deletion (tenant + admin wire their own action). */
export function DeleteStoreDialog({
  storeName,
  deviceCount,
  armedCount,
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  storeName: string;
  deviceCount: number;
  armedCount: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete store?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                This permanently deletes <span className="font-medium">{storeName}</span>.
              </p>
              {deviceCount > 0 && (
                <p>
                  {deviceCount} {deviceCount === 1 ? "device" : "devices"} will move to{" "}
                  <span className="font-medium">Unassigned devices</span> and can be
                  assigned to another store later.
                </p>
              )}
              {armedCount > 0 && (
                <p className="text-amber-600 dark:text-amber-500">
                  {armedCount} {armedCount === 1 ? "device" : "devices"} prepared for
                  zero-touch setup will need to be re-armed by Maratus.
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            Delete store
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create `components/store-delete-button.tsx`**

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteStoreDialog } from "@/components/delete-store-dialog";
import { deleteStore } from "@/lib/actions/stores";

export function StoreDeleteButton({
  store,
  deviceCount,
  armedCount,
}: {
  store: { id: string; name: string };
  deviceCount: number;
  armedCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function onConfirm() {
    setPending(true);
    const res = await deleteStore(store.id);
    setPending(false);
    if (!res.ok) {
      toast.error("Couldn't delete store", { description: res.error });
      return;
    }
    toast.success("Store deleted");
    setOpen(false);
    router.push("/tenant/stores");
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" />
        Delete store
      </Button>
      <DeleteStoreDialog
        storeName={store.name}
        deviceCount={deviceCount}
        armedCount={armedCount}
        open={open}
        onOpenChange={setOpen}
        pending={pending}
        onConfirm={onConfirm}
      />
    </>
  );
}
```

- [ ] **Step 3: Create `components/unassigned-devices.tsx`**

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Link2Off } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { assignDeviceToStore } from "@/lib/actions/devices";
import type { Device } from "@/lib/types";

/** Inventory-style pool of claimed devices whose store was deleted. */
export function UnassignedDevices({
  devices,
  stores,
  canManage,
}: {
  devices: Device[];
  stores: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [targets, setTargets] = React.useState<Record<string, string>>({});

  async function assign(deviceId: string) {
    const storeId = targets[deviceId];
    if (!storeId) return;
    setPendingId(deviceId);
    const res = await assignDeviceToStore(deviceId, storeId);
    setPendingId(null);
    if (!res.ok) {
      toast.error("Couldn't assign device", { description: res.error });
      return;
    }
    toast.success("Device assigned");
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Link2Off className="size-4 text-muted-foreground" />
          Unassigned devices
        </h2>
        <p className="text-sm text-muted-foreground">
          These printers belonged to a deleted store. Assign them to a store to
          manage them again — they keep working in the meantime.
        </p>
      </div>
      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Device</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-64 text-right">Assign to store</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <StatusDot status={d.status} />
                    <span className="capitalize">{d.status}</span>
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {canManage && (
                    <span className="inline-flex items-center gap-2">
                      <Select
                        value={targets[d.id] ?? ""}
                        onValueChange={(v) => setTargets((t) => ({ ...t, [d.id]: v }))}
                      >
                        <SelectTrigger className="w-44" size="sm">
                          <SelectValue placeholder="Pick a store" />
                        </SelectTrigger>
                        <SelectContent>
                          {stores.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        disabled={!targets[d.id] || pendingId === d.id}
                        onClick={() => assign(d.id)}
                      >
                        Assign
                      </Button>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  );
}
```

Adapt small details to the codebase while implementing: `StatusDot`'s actual prop name (check `components/status-badge.tsx`) and `SelectTrigger`'s size prop (drop `size="sm"` if the component doesn't accept it). Do not restructure otherwise.

- [ ] **Step 4: Render the pool on `app/(tenant)/tenant/stores/page.tsx`**

Add imports:

```tsx
import { UnassignedDevices } from "@/components/unassigned-devices";
import { getTenantStores, getTenantUnassignedDevices } from "@/lib/data";
```

(replacing the existing `getTenantStores` import line). In the component body, after `const stores = ...`:

```tsx
  const unassigned = await getTenantUnassignedDevices(organizationId);
```

After the closing `</Card>` of the stores table (still inside the fragment), add:

```tsx
      {unassigned.length > 0 && (
        <UnassignedDevices
          devices={unassigned}
          stores={stores.map((s) => ({ id: s.id, name: s.name }))}
          canManage={canManage}
        />
      )}
```

- [ ] **Step 5: Render the delete button on `app/(tenant)/tenant/stores/[storeId]/page.tsx`**

Add imports:

```tsx
import { StoreDeleteButton } from "@/components/store-delete-button";
import { getArmedAllocationCountByStore } from "@/lib/data";
```

In the component body (after `unclaimed` is computed):

```tsx
  const armedByStore = canClaim ? await getArmedAllocationCountByStore(organizationId) : {};
```

Locate the existing `<StoreEditButton store={...} />` usage and render the delete button beside it (same wrapper, gated the same way as edit — if edit is gated on `canClaim`/`canManage`, use the same gate):

```tsx
  <StoreDeleteButton
    store={{ id: store.id, name: store.name }}
    deviceCount={store.devices.length}
    armedCount={armedByStore[store.id] ?? 0}
  />
```

- [ ] **Step 6: Type-check and test**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add components/delete-store-dialog.tsx components/store-delete-button.tsx components/unassigned-devices.tsx "app/(tenant)/tenant/stores/page.tsx" "app/(tenant)/tenant/stores/[storeId]/page.tsx"
git commit -m "feat(tenant): unassigned device pool + store delete UI"
```

---

### Task 5: Admin UI — stores card with delete on customer detail

**Files:**
- Create: `components/customers/admin-stores-card.tsx`
- Modify: `app/(admin)/admin/customers/[tenantId]/page.tsx`

**Interfaces:**
- Consumes: `deleteStoreForOrg` (Task 3), `DeleteStoreDialog` (Task 4), `getArmedAllocationCountByStore` (Task 2). Page already has `tenant.stores`, `isArchived`.
- Produces: nothing downstream.

- [ ] **Step 1: Create `components/customers/admin-stores-card.tsx`**

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeleteStoreDialog } from "@/components/delete-store-dialog";
import { deleteStoreForOrg } from "@/lib/actions/stores";

interface AdminStoreRow {
  id: string;
  name: string;
  address: string;
  deviceCount: number;
  armedCount: number;
}

/** Store list on the admin customer page, with per-store delete (hidden when archived). */
export function AdminStoresCard({
  organizationId,
  stores,
  readOnly,
}: {
  organizationId: string;
  stores: AdminStoreRow[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState<AdminStoreRow | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onConfirm() {
    if (!confirming) return;
    setPending(true);
    const res = await deleteStoreForOrg(organizationId, confirming.id);
    setPending(false);
    if (!res.ok) {
      toast.error("Couldn't delete store", { description: res.error });
      return;
    }
    toast.success("Store deleted");
    setConfirming(null);
    router.refresh();
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Stores</CardTitle>
        <CardDescription>
          {stores.length} {stores.length === 1 ? "branch" : "branches"}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Store</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="text-center">Devices</TableHead>
              {!readOnly && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {stores.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="text-muted-foreground">{s.address || "—"}</TableCell>
                <TableCell className="text-center">{s.deviceCount}</TableCell>
                {!readOnly && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => setConfirming(s)}
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">Delete {s.name}</span>
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <DeleteStoreDialog
        storeName={confirming?.name ?? ""}
        deviceCount={confirming?.deviceCount ?? 0}
        armedCount={confirming?.armedCount ?? 0}
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
        pending={pending}
        onConfirm={onConfirm}
      />
    </Card>
  );
}
```

- [ ] **Step 2: Render it on `app/(admin)/admin/customers/[tenantId]/page.tsx`**

Add imports:

```tsx
import { AdminStoresCard } from "@/components/customers/admin-stores-card";
import { getArmedAllocationCountByStore } from "@/lib/data";
```

In the component body (near the other data fetches):

```tsx
  const armedByStore = await getArmedAllocationCountByStore(tenant.id);
```

After the "Activations by store" `Card`, render:

```tsx
      <AdminStoresCard
        organizationId={tenant.id}
        readOnly={isArchived}
        stores={tenant.stores.map((s) => ({
          id: s.id,
          name: s.name,
          address: s.address,
          deviceCount: s.devices.length,
          armedCount: armedByStore[s.id] ?? 0,
        }))}
      />
```

(The page's actual variable names may differ slightly — `detail`/`tenant`/`isArchived` — match what the file uses; `isArchived` is derived at ~line 74.)

- [ ] **Step 3: Type-check and test**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/customers/admin-stores-card.tsx "app/(admin)/admin/customers/[tenantId]/page.tsx"
git commit -m "feat(admin): stores card with delete on customer detail"
```

---

### Task 6: Verification — build + manual QA (production-safe)

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything above.
- Produces: QA results recorded in the task report; branch ready for merge.

⚠️ **Production-safety rules for this task:** `.env.local` = PRODUCTION Neon. NEVER run `npm run db:seed`, `db:push`, or `db:generate`. QA only via the app UI against a DISPOSABLE store. Never touch the "Downtown Flagship" store (physical device b580 lives there).

- [ ] **Step 1: Full gates**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: all clean.

- [ ] **Step 2: Manual QA walk (run `npm run dev`, sign in as dana@roastwell.co / 123456)**

1. `/tenant/stores`: no "Unassigned devices" section (pool empty).
2. Create store "QA Temp". Open it → "Delete store" button visible next to Edit.
3. Note the org's total device count on `/tenant` dashboard.
4. As admin (admin@maratus.app / 123456) on the customer page: Stores card lists all stores incl. QA Temp with device counts; provision a virtual device INTO "QA Temp" (existing provision flow), or as dana claim nothing — a provisioned-unclaimed device must NOT enter the pool later (claimedAt null). To create a poolable device instead: use the admin device row action "Move to store" to move an EXISTING claimed test device (NOT b580) into QA Temp — if none exists, skip pool-content checks and verify empty-store deletion only.
5. As dana: delete "QA Temp" → dialog shows the correct device count → confirm → redirected to `/tenant/stores`; if it had a claimed device, "Unassigned devices" section now lists it; `/tenant` dashboard totals unchanged from step 3.
6. Assign the pool device to another store (NOT Downtown Flagship if avoidable) → pool section disappears, device visible under the target store, device detail page reachable.
7. Tenant Activity (audit) page shows "Store deleted" and "Device reassigned" entries with friendly labels.
8. Admin customer page: pool device appeared with store "—" while unassigned (check before step 6, or re-unassign via admin row action and re-check, then re-assign).
9. Archived-customer check (read-only): an archived org's customer page hides the Stores card delete column. If no archived org exists in prod data, verify the `readOnly` gate by code inspection and record that.
10. Member-role check: as a member (non-owner/admin) user if one exists, `/tenant/stores` store detail shows no Delete button. If no member user exists, record as code-inspection-verified.

- [ ] **Step 3: Record results**

Write pass/fail per item into the task report. Any failure → fix within the owning task's scope before merge.

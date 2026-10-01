# Store Deletion & Unassigned Device Pool — Design

**Date:** 2026-07-11
**Repo:** maratus-admin (no firmware changes)
**Requested by:** customer stores can close; tenants need to delete a store, with its devices dropping into an inventory-style unassigned pool for later reassignment.

## Background

Stores (`store` table) currently support create and update only (`lib/actions/stores.ts`); there is no delete. The schema is already delete-ready: `device.storeId` and `factoryDevice.allocatedStoreId` both reference `store.id` with `onDelete: "set null"` — deleting a store row nulls those FKs at the DB level. What's missing is the application layer: today the tenant panel derives every device list by grouping devices into stores (`lib/data.ts` `getTenant` → `.filter((d) => d.storeId === s.id)`), so a null-`storeId` device would silently vanish from the UI and from every aggregate computed via `tenant.stores.flatMap(...)`.

Verified non-impacts: a storeless device keeps working — the trigger API scopes by org+device, device polling is device-key scoped, and the on-device clock timezone comes from the branding config's `clockTimezone`, not from `store.timezone` (which is used only for per-store analytics bucketing).

## Decisions (from brainstorming)

- **Unassigned pool, not forced reassignment:** deleting a store drops its devices into an org-level "Unassigned devices" pool (inventory-style); the customer assigns them to any store later, at their own pace. (Approach A: nullable `storeId` + pool UI. Rejected: hidden system "warehouse" store per org — pollutes lists/analytics; forced move-on-delete — contradicts the requirement.)
- **Both roles can delete:** tenant owner/admin from the tenant panel, and platform admin from the customer detail page.

## Design

### 1. Data model

No schema change, no migration. One new audit constant in `lib/audit.ts` + label in `lib/audit-labels.ts`:

- `AUDIT.storeDeleted` (`store.deleted`) — metadata: `{ name, unassignedDeviceCount, disarmedAllocationCount }`.
- Assignment reuses the EXISTING `AUDIT.deviceReassigned` (the admin `reassignDevice` action already records it with `{ storeId }`).

**Pool membership:** `storeId IS NULL AND claimedAt IS NOT NULL`. Unclaimed provisioned devices are also storeless by design and must stay out of the pool (they live in the claim flow via `getUnclaimedDevices`). Bonus: the pool also fixes a pre-existing invisibility — the admin `unassignDevice` action already produces claimed storeless devices that today disappear from every list.

### 2. Actions (`lib/actions/stores.ts`)

- `deleteStore(storeId)` — tenant-scoped. `requireTenant()`; owner/admin membership check (same rule as create/update); verify the store belongs to the active org. Count the store's devices and its armed factory allocations (`factoryDevice` where `allocatedStoreId = storeId AND status = 'allocated'`) for audit metadata, then `DELETE` the store row — the FKs null out `device.storeId` and `factoryDevice.allocatedStoreId`. Record audit; revalidate `/tenant/stores`, `/tenant`. Returns `{ ok, error? }`.
- `deleteStoreForOrg(organizationId, storeId)` — platform-admin variant (parity with `createStoreForOrg`): `requirePlatformAdmin()` + `isOrgArchived` guard + same body; revalidates `/admin/customers/[id]`.
- `assignDeviceToStore(deviceId, storeId)` — tenant-scoped, in `lib/actions/devices.ts` (sibling of the admin-scoped `reassignDevice`, same `ActionResult` conventions). Owner/admin check; verify BOTH the device and the target store belong to the active org; set `device.storeId`; audit `deviceReassigned`; revalidate stores + tenant pages. Also serves as a general move-between-stores primitive, but v1 UI only surfaces it on the unassigned pool.

No dedicated confirmation token: the operation is moderate-risk (devices remain claimed, keyed, and functional; only grouping is lost), so a consequence-listing confirm dialog suffices — no typed-name confirmation.

### 3. Data layer (`lib/data.ts`)

- `Tenant` view-model gains `unassignedDevices: Device[]` (devices with `storeId === null`, converted by the existing device mapper; `storeId` field stays `""` per current convention).
- Every aggregate currently computed as `tenant.stores.flatMap((s) => s.devices)` (tenant overview totals, health rollups, device counts — audit each call site) is updated to include `unassignedDevices`, so pool devices keep counting toward dashboard metrics, health, and admin summaries.
- Admin-side lists that show a device's store render "—" when unassigned (verify `getAdminDevice`/fleet queries left-join store rather than inner-join; fix any inner joins that would drop pool devices).

### 4. Tenant UI

- **`/tenant/stores`:** below the store grid, an "Unassigned devices" `PageSection` rendered only when the pool is non-empty. Each row: device name, serial (if any), status dot — plus a store `Select` and an "Assign" button wired to `assignDeviceToStore`. No device-detail navigation from the pool in v1 (detail pages live under `/tenant/stores/[storeId]/[deviceId]`; a device becomes navigable again once assigned).
- **`/tenant/stores/[storeId]`:** a "Delete store" affordance (danger-styled, near the existing edit UI). Confirm dialog states the consequences concretely: "N devices will move to Unassigned" and — when `disarmedAllocationCount > 0` — "M devices prepared for zero-touch setup will need to be re-armed by Maratus". On success, redirect to `/tenant/stores`.

### 5. Admin UI

- Customer detail page: per-store delete button (same confirm dialog), guarded by `isOrgArchived` and hidden in the archived read-only state, wired to `deleteStoreForOrg`.
- Unassigned devices appear in admin device lists with store "—". Assignment from the admin side is out of scope for v1 (tenant assigns).

### 6. Factory registry interaction

Deleting a store nulls `allocatedStoreId` on `allocated` rows (DB FK). Auto-claim arming requires BOTH org and store, so those serials are disarmed until a platform admin re-allocates them from the existing inventory UI. This is intentional (the target store no longer exists); the delete dialog and audit metadata make it visible. No registry status change is performed by store deletion.

### 7. Out of scope (v1)

- Moving devices between two live stores from the UI (the action supports it; no UI surface yet).
- Admin-side assignment UI for pool devices.
- Claiming a NEW device without any store (claim flow still requires a store page).
- Store archival/soft-delete — hard delete + audit is enough; per-store analytics history disappears with the store (device trigger history itself is untouched and re-buckets under the device's next store).

## Testing

- **Unit (vitest, `npm test`):** the repo has no DB-action test harness — actions are thin Drizzle wrappers and are QA'd manually like all existing actions. Unit coverage = pure logic only: the `AUDIT_LABELS` completeness test (`lib/audit-labels.test.ts`) already fails if `storeDeleted` lands without a label (built-in TDD hook).
- **Manual QA:** ⚠️ `.env.local` points at PRODUCTION Neon — `npm run db:seed` is FORBIDDEN (a previous reseed wiped the physical HIL device). QA uses a disposable store: in the Roastwell org create "QA Temp" store → provision a virtual device into it → delete the store → pool appears on `/tenant/stores`; dashboard totals unchanged; assign the device to another store → pool empties, device navigable under the new store; re-delete "QA Temp" empty → no pool section; archived customer: no delete button, admin action refuses; delete dialog shows the re-arm warning when an armed allocation exists (verify count query manually if no armed serial is available). Never touch the Downtown Flagship store (physical device b580 lives there).

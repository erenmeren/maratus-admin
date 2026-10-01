# Customer Offboarding & Archive — Design

**Date:** 2026-07-10
**Status:** Approved
**Scope:** maratus-admin only (no firmware change)

## Problem

Customers (organizations) can be created but never removed. A hard DELETE is the
wrong tool: all 11 org-referencing tables cascade, so it would destroy the
credit ledger (revenue history), the audit trail, device rows for physical
hardware in the field, and factory-registry linkage. A churned customer must
disappear from day-to-day operations while their financial and audit history
stays intact — and offboarding has a physical dimension: their printers are
real inventory tracked in the factory registry.

Decisions agreed during brainstorming:

- **Device fate is decided per device at offboarding** (mixed rental/purchase
  reality): returned to Maratus stock, or left with the customer.
- **Access closes, data stays.** Members lose access to the org; user/member
  rows, credit ledger, and audit log are retained. PII anonymization is a
  separate future feature if a KVKK/GDPR erasure request ever arrives (YAGNI).
- **Archive + restore.** Archived customers leave the default list, remain
  reachable via an "Archived" filter as read-only pages, and can be restored.

"Delete" is therefore a lifecycle transition, never row deletion.

## Data model

`tenantSettings` (app-owned, PK = orgId — the `organization` table is Better
Auth-managed and stays untouched) gains:

| Column | Type | Notes |
|---|---|---|
| `archivedAt` | timestamp, nullable | null = active; set only when offboarding completes |
| `archivedNote` | text, nullable | optional human reason ("contract ended …") |

Derived status: `archivedAt` set → the view models report **"archived"**. The
existing `tenantSettings.status` (`active|paused`) is unrelated operational
state and is not modified by this feature.

New audit constants (+ labels; the completeness guard test enforces pairs):
`org.archived`, `org.restored`, `device.returned_to_stock`,
`device.left_with_customer`.

One additive migration (2 columns). No rows are ever deleted by this feature —
except device rows for units returned to stock (see below), which is a
deliberate identity retirement, not data loss (the offboarding summary and
audit events preserve the record).

## Offboarding wizard

Entry point: "Offboard customer…" in the destructive zone of the admin
customer-detail page. One Dialog, three sections, confirmed by typing the
organization name. On confirm, ONE server action executes the steps in order.

**Idempotency requirement:** each step is independently idempotent and the
whole action is re-runnable. `archivedAt` is written only at the very end, so
a half-completed run leaves the org visibly active and the wizard can simply
be run again to completion.

### Step 1 — Device dispositions (per device, chosen in the wizard)

Wizard lists the org's devices, each with a radio (default **Return to
stock**) and an "apply to all" shortcut.

- **Return to stock:** delete the device row (commands cascade; the key hash
  dies with it, so the physical unit can never reconnect under that
  identity), then move its factory-registry row to **`manufactured`**
  clearing `allocatedOrganizationId`/`allocatedStoreId`/`deviceId`/`claimedAt`
  — the serial becomes re-allocatable to a new customer. Transactional per
  device (dbTx + `SELECT FOR UPDATE`, same discipline as
  `revertRegistryClaim`/`deallocateSerials`). Audit `device.returned_to_stock`
  (metadata: serial, deviceName).
- **Leave with customer:** device row stays with `status: "paused"`; its
  registry row becomes **`retired`** with `deviceId` still linked (traceable).
  Audit `device.left_with_customer`. If the unit is ever physically returned
  later, the existing registry flow covers it (mark `rma` → revert) — no new
  mechanism.
- Devices with no serial (pre-registry units) skip the registry transition
  silently.

**Allocation sweep (security-relevant):** after per-device handling, ALL
factory rows still `allocated` to this org are reverted to `manufactured`
(existing `deallocateSerials`). Without this, zero-touch auto-claim could
still mint a device key in the archived org's name from a public serial.

### Step 2 — Access shutdown

- Revoke every non-revoked API key of the org (`revokedAt = now()`): trigger
  API calls fail with 401 immediately.
- Cancel pending invitations.
- No session-kill mechanism: the gate is `requireTenant` (below), which makes
  live sessions harmless. Member/user rows are untouched.

### Step 3 — Archive

- Freeze the prepaid credit balance as-is: no rows deleted, no adjustment
  written. Refunds, if any, happen off-platform via Stripe (no platform
  refund flow — YAGNI).
- Set `archivedAt` + `archivedNote`; record `org.archived` with a metadata
  summary: device dispositions (returned/left counts + serials), frozen
  credit balance, revoked key count.

## Enforcement points

- **`requireTenant` (lib/session.ts):** if the active org is archived, block
  entry to the tenant panel; fall back to the member's first non-archived
  org, or an "organization archived" notice when none exists. This is the
  single central gate — it is why no session revocation is needed.
- **v1 API guard:** no change needed (keys are revoked). An additional
  `archivedAt` check in the guard is deliberately NOT added (YAGNI; the key
  revocation is the mechanism, and restore would have to remember to undo it).
- **Claim endpoint:** nothing to change — the allocation sweep removes every
  auto-claim path, and the human path requires tenant-panel access.
- **Default exclusions (lib/data.ts):** `loadAllOrgs`, `getTenantSummaries`,
  `getAllDevices`, and platform KPIs exclude archived orgs by default. An
  `includeArchived` option exists solely for the Customers list's filter.
  The health cron inherits the exclusion for free.

## Admin UI

- **Customers list:** `Active | Archived | All` segment filter (URL state,
  same pattern as the inventory page). Archived rows show a muted "Archived"
  badge + archive date.
- **Archived customer detail:** read-only — every mutating action (provision
  device, grant credits, settings) hidden or disabled; credit history, audit
  trail, and an "Offboarding summary" card (which device went where, from the
  `org.archived` audit metadata) remain visible. Single action: **Restore
  customer** (confirm dialog).
- **Offboard button:** destructive zone of the customer detail page; opens
  the wizard; requires typing the org name to arm the confirm button.

## Restore

Sets `archivedAt = null`, records `org.restored`. Members can sign in again.
Deliberately NOT undone (the restore dialog states this explicitly):

- revoked API keys (new ones are created normally),
- device dispositions (returned stock re-enters via normal allocation/claim),
- cancelled invitations.

## Edge cases

- Re-running a half-completed offboard: step 1 skips already-handled devices
  (device row gone / already paused+retired), step 2's revoke/cancel are
  no-op-safe, step 3 stamps last. No "half archived" state is visible.
- An org with zero devices/keys degrades to just Step 3.
- Archived orgs have no cron/webhook dependencies (webhook subsystem was
  removed; health evaluation excludes archived orgs).
- Members whose ONLY org is archived: they can still authenticate (Better
  Auth) but land on the "organization archived" notice, not a tenant panel.

## Testing

- Pure logic in `lib/` with vitest: derived-status mapping, per-device
  disposition → registry-transition decision table, offboarding-summary
  metadata shape.
- Server actions verified against the dev DB (create → offboard → assert
  device/registry/key/invitation states → restore → assert access), with
  cleanup.
- Migration: one additive migration; trim generated SQL to this feature
  (drizzle snapshot-drift hazard).

## Out of scope (deliberate)

- Automatic credit refunds (manual via Stripe).
- PII anonymization / hard erasure (separate feature upon KVKK/GDPR request).
- Hard delete of organizations.
- Tenant-side self-service account closure.
- Scheduled/automatic archiving of inactive customers.

## Alternatives considered

- **Extend `tenantSettings.status` with `churned`:** cheapest, rejected — no
  device/key/invitation handling (half an offboarding), conflates
  operational pause with lifecycle end, muddy restore semantics.
- **Export + hard delete:** rejected — destroys credit ledger and audit
  trail (Stripe holds only part of the financial picture), breaks factory
  registry linkage, irreversible; directly contradicts the retention
  requirement that motivated this feature.

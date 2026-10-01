# Register number, device naming, trigger-by-register, return-to-stock — design

Date: 2026-10-01 · Status: draft for review

## Goal

A customer pairs a device and tells us which **register** (kasa) it sits at.
Their POS can then trigger the device by its own register number, so they never
have to map Maratus device IDs into their systems. Devices get friendly default
names. Platform admins can return an RMA'd/retired serial to stock.

## What was said vs. assumed

Said: editable device name with a `device_{n}` default when none is given;
register number captured at pairing; a second trigger endpoint addressed by
register number; register number unique **org-wide**; "Return to stock" for
inventory rows that are stuck in `rma`.

Assumed (change on review): register numbers are case-insensitive, 1–40 chars of
`A-Z a-z 0-9 . _ -`; tenant members with `canManageTenant` may edit name and
register number, platform admins may edit any device; zero-touch devices start
with no register number.

## 1. Data model

- `device.registerNumber text NULL` (migration 0048).
- Unique index on `(organization_id, lower(register_number)) WHERE register_number IS NOT NULL`.
- `lib/register-number.ts`: `normalizeRegisterNumber(input)` → trimmed string or
  `null` for empty; throws/returns an error for invalid chars or length.
  Stored as entered (display case preserved); lookup is by `lower()`.
- `device.name` stays `NOT NULL`.

## 2. Device naming

- `nextDefaultDeviceName(organizationId)` → `device_{n}`, `n` = highest existing
  `device_<digits>` suffix in the org + 1 (1 when none). Not count-based, so
  deleted devices never cause a collision.
- Used wherever a name is currently invented: zero-touch `autoClaimDevice`
  (`Printer ${serial.slice(-4)}`), pairing-code claim without a name, admin
  `provisionDevice` ("New Printer"). Seed data is left alone.
- Name and register number are set in the **claim dialog** (both optional) and
  edited later through an **Edit device** dialog (name + register number) on the
  tenant device row/detail and the existing admin `DeviceRowActions`. A single
  server action `updateDeviceDetails(deviceId, {name?, registerNumber?})`
  authorizes tenant (own org, `canManageTenant`) or platform admin, validates,
  writes, audits (`AUDIT.deviceRenamed` / new `deviceRegisterChanged`), and
  maps the unique-index violation to a friendly "already used by <device>".
  The existing `renameDevice` delegates to it.

## 3. Trigger by register

- `POST /api/v1/registers/{registerNumber}/trigger` — same API key,
  `devices:trigger` scope, required `Idempotency-Key`, body
  `{ action, payload: { url } }`, same 202 `{id,status:"queued"}` response.
- The body of `app/api/v1/devices/[deviceId]/trigger/route.ts` moves to
  `lib/api/trigger-device.ts` (`handleTrigger(req, resolveDevice)`); both routes
  are thin wrappers. Ownership, online check, subscription gate, idempotency,
  MQTT publish and failure handling are unchanged.
- Lookup: `organizationId = auth.organizationId AND lower(registerNumber) = lower(param)`.
  Miss → `404 register_not_found`. Idempotency keys are shared across both
  endpoints (same table, same org scope).
- `GET` device payloads in the public API gain `registerNumber`; `openapi.json`
  and the docs site (Scalar, personalised examples) document the new endpoint.

## 4. Return to stock (inventory)

- `returnSerialToStockAction(serial)` (platform admin) and a menu item
  "Return to stock…" with a confirm dialog on `rma` / `retired` rows.
- No linked device row: set `status='manufactured'`, clear
  `allocatedOrganizationId/allocatedStoreId/deviceId/claimedAt`, audit.
- Linked device row exists: refuse with "Delete the device first" (the existing
  `returnDeviceToStock` is the destructive path and stays where it is).
- Idempotent: already `manufactured` → ok, no change.

## 5. Testing (TDD)

- Unit: `normalizeRegisterNumber` (trim, length, charset, empty→null);
  `nextDefaultDeviceName` (none, gaps, non-matching names).
- Route: register trigger 404, success 202, case-insensitive match, cross-org
  isolation, idempotent replay; device-id route regression via shared handler.
- Actions: duplicate register number → friendly error; tenant cannot edit a
  device in another org; return-to-stock refuses when a device is linked.

## Out of scope

Bulk import of register numbers, per-store register namespaces, renaming
register numbers via API, changing zero-touch to prompt for a register number.

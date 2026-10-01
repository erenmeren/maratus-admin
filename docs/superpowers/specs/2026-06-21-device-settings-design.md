# Device Settings — Design

**Date:** 2026-06-21
**Status:** Approved (design)
**Scope:** Cloud (maratus-admin) + coordinated firmware (maratus-firmware, separate plan)

## Overview

A new **Device Settings** page in the tenant panel — a sidebar nav item directly
under **Branding** — where org owners/admins set five org-wide device policies:

1. How long the QR code stays visible
2. Screen brightness
3. Whether the device sleeps or stays awake
4. The inactivity timeout before sleep (when sleep is enabled)
5. The password for the device's on-device Settings page

Settings are **org-wide**: they apply to every device in the organization. Saving
writes to the existing `tenantSettings` row, then broadcasts a `config-changed`
command to every device in the org via the existing `enqueueConfigChangedForOrg()`.
Devices re-pull `GET /api/device/config` on their next poll and converge on the new
settings automatically — the exact mechanism Branding already uses. There is no
per-device settings storage.

## Why this fits the existing architecture

- **Org-wide settings already live in `tenantSettings`** (PK = `organizationId`),
  served to devices through `GET /api/device/config`.
- **Change propagation already exists.** `saveBranding()` upserts `tenantSettings`,
  then calls `enqueueConfigChangedForOrg()`, which enqueues a `config-changed`
  command (already a valid command type) for every device in the org. Devices poll
  `/api/device/commands`, see `config-changed`, and re-pull config. Device Settings
  reuses this verbatim — no new command type, no new delivery channel.
- **ETag versioning already exists.** `computeConfigVersion()` hashes the stored
  config inputs; any change bumps the ETag and forces a device re-fetch.

## 1. Data model — new `tenantSettings` columns

Add to `lib/db/schema.ts` `tenantSettings` (PK = `organizationId`):

| Column | Type | Default | Range / notes |
|---|---|---|---|
| `qrVisibleSeconds` | `integer` | `60` | 15–180. **Promoted** from `printerScreens.qrTimeoutSeconds` — becomes the single source of truth |
| `screenBrightness` | `integer` | `100` | clamped 10–100 (screen never goes fully unreadable) |
| `screenSleepEnabled` | `boolean` | `false` | `false` = stay awake |
| `screenSleepTimeoutSeconds` | `integer` | `300` | 30–3600 (30s–60min); ignored by device when sleep is off, but value is preserved |
| `deviceSettingsPasswordHash` | `text` | `null` | `sha256(salt + password)` |
| `deviceSettingsPasswordSalt` | `text` | `null` | random salt generated each time the password is set |

### Password handling

A PIN/password is low-entropy, so unlike high-entropy device keys (which use an
unsalted `sha256`), the settings password is **salted**: a random salt is generated
when the password is set, and the device receives both `hash` and `salt` so it can
compute `sha256(salt + typedPIN)` and compare locally. The admin UI never receives
the hash — only a `hasPassword: boolean`.

## 2. QR duration: move + migrate

The "how long the QR stays visible" value currently exists as
`PrinterConfig.qrTimeoutSeconds` (15–180), edited via the Branding printer editor's
receipt-screen countdown control and stored inside the `printerScreens` JSONB.

- **UI move:** remove the countdown-duration control from the Branding editor
  (`PrinterControls`) and surface it in Device Settings instead. (The Branding
  preview may still display a representative countdown using the configured value.)
- **Storage move:** the value's source of truth becomes the new top-level
  `qrVisibleSeconds` column.
- **Device contract unchanged:** `getDeviceConfig()` overlays
  `config.qrTimeoutSeconds = qrVisibleSeconds` at delivery time, so firmware keeps
  reading `config.qrTimeoutSeconds` exactly as before.
- **Backfill:** a one-time script copies each org's existing
  `printerScreens.qrTimeoutSeconds` into the new `qrVisibleSeconds` column (default
  60 if absent), so existing orgs keep their configured value.

## 3. Config delivery

`lib/data.ts` — `DeviceConfigPayload` gains a `device` block:

```ts
device: {
  brightness: number,                  // 0..100 (clamped 10..100)
  sleep: { enabled: boolean, timeoutSeconds: number },
  settingsPasswordHash: string | null,
  settingsPasswordSalt: string | null,
}
```

and `config.qrTimeoutSeconds` is set from `qrVisibleSeconds` (overlay).

`lib/device-config.ts` — all six new stored values feed `computeConfigVersion()`'s
input so the ETag bumps when any of them change and devices re-fetch. These are
stored values (not presigned URLs), so they are safe to include in the hash.

## 4. Page, action, data layer (mirrors Branding)

- **`app/(tenant)/tenant/device-settings/page.tsx`** — server component:
  `requireTenant()`, owner/admin gate (same as Branding), fetch
  `getTenantDeviceSettings(orgId)`, render the client form with initial values.
- **`app/(tenant)/tenant/device-settings/actions.ts`** —
  `saveDeviceSettings(formData)`: owner/admin auth gate → parse, validate, and clamp
  → password logic (set new salt+hash if a new password is provided; keep existing
  if the field is left blank; clear both if the user explicitly removes it) → upsert
  `tenantSettings` (only the device-settings columns + `qrVisibleSeconds`) →
  `enqueueConfigChangedForOrg(orgId, userId)` → `revalidatePath` → audit log.
  Returns `{ ok, error? }`.
- **`lib/data.ts`** — `getTenantDeviceSettings(orgId)` returns a view model with
  `hasPassword: boolean` (never the hash); a pure `normalizeDeviceSettings()` clamp
  helper (host-testable, mirroring `normalizePrinterConfig`).
- **Client form** — sticky dirty-state save bar (same pattern as Branding):
  brightness slider (0–100), QR-duration slider (15–180), sleep toggle with a
  conditional inactivity-timeout field, and a password field with set / change /
  clear affordances ("leave blank to keep current").

## 5. Navigation

`lib/nav.ts`: insert into `TENANT_NAV` directly after Branding:

```ts
{ label: "Device Settings", href: "/tenant/device-settings", icon: MonitorCog }
```

## 6. Firmware (maratus-firmware — coordinated, separate plan)

This spec is the **contract**; firmware implementation is a separate milestone in
the maratus-firmware repo, HIL-tested like prior milestones. Device behavior:

- **Brightness** → map 0–100 to the LCD PWM backlight duty (cloud already clamps to
  ≥10, so the screen can't be bricked dark).
- **Screen sleep** → when `sleep.enabled`, after `sleep.timeoutSeconds` of no touch
  and no active receipt on screen, turn the display/backlight off. **CPU keeps
  polling** so receipts and remote commands still arrive. Wake on touch or on an
  incoming receipt. (No deep sleep — the device must stay reachable.)
- **Settings PIN** → the on-device Settings screen prompts for a PIN; the device
  computes `sha256(salt + input)` and compares to the delivered hash. When no hash
  is configured, the settings screen is **ungated**.
- **Propagation** → `config-changed` already triggers a config re-pull; no new
  command type is needed.

## Resolved decisions

- **QR duration:** move to Device Settings as the single source of truth (overlay at
  delivery keeps the firmware contract stable).
- **Password:** stored salted-`sha256`; hash + salt delivered to the device for local
  comparison.
- **Sleep semantics:** screen sleep only (display off, CPU awake) — never deep sleep.
- **Brightness:** 0–100% slider, clamped to a 10% floor.
- **Sleep timeout bounds:** 30s–60min.
- **No-PIN behavior:** on-device Settings screen is ungated when no password is set.
- **Scope:** cloud changes land in maratus-admin; firmware honoring brightness/sleep is
  a coordinated, separately-planned maratus-firmware milestone.

## Validation ranges (authoritative)

- `qrVisibleSeconds`: 15–180 (clamp)
- `screenBrightness`: 10–100 (clamp; UI slider 0–100)
- `screenSleepTimeoutSeconds`: 30–3600 (clamp)

## Edge cases

- **Existing orgs:** new columns get defaults; `qrVisibleSeconds` is backfilled from
  the existing JSONB value.
- **Password unchanged on save:** blank field preserves the existing hash/salt.
- **Sleep disabled:** timeout value is preserved but ignored by the device.
- **Out-of-range input:** clamped server-side, so a bad brightness can't make the
  screen unreadable.

## Testing

- Pure functions: `normalizeDeviceSettings()` clamping, password hashing — host-tested.
- ETag: a test asserting `computeConfigVersion()` changes when each new field changes.
- Server action: auth gate, clamping, and that a save triggers the org-wide
  `config-changed` broadcast.

## Files touched (cloud)

- `lib/db/schema.ts` — new columns (+ migration)
- `lib/data.ts` — `DeviceConfigPayload.device`, `getDeviceConfig()` overlay,
  `getTenantDeviceSettings()`, `normalizeDeviceSettings()`
- `lib/device-config.ts` — `computeConfigVersion()` inputs
- `lib/nav.ts` — nav item
- `app/(tenant)/tenant/device-settings/{page.tsx,actions.ts}` — new
- `components/device-settings/*` — new client form
- Branding editor (`PrinterControls`) — remove the QR-duration control
- One-time backfill script — `qrTimeoutSeconds` → `qrVisibleSeconds`

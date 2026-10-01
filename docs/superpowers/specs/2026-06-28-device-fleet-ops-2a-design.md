# Phase 2A — Device Fleet Ops — Design

**Date:** 2026-06-28
**Repo:** `maratus-admin`
**Status:** Approved design, pre-implementation
**Phase:** 2 ("feature expansion"), sub-project **2A** (first). Siblings: **2B** tenant-health drill-down + alert delivery, **2C** audit-log UI polish.

## Problem

The device command infra, firmware tracking, and fleet table already exist, but platform admins lack operational depth:
- **No admin device detail page** — `/admin/devices` is a flat table with row actions; there's no per-device view with the CommandBar (reboot/identify/firmware-update), firmware state, lastSeen, and command history that the tenant side already has at `app/(tenant)/tenant/stores/[storeId]/[deviceId]/page.tsx`.
- **No firmware visibility in the fleet table** — `FleetTable` has no firmware column or "update available" badge; that only exists on the tenant device detail page.
- **No automated offline detection** — a device's DB `status` stays `"online"` indefinitely; `effectiveDeviceStatus` (`lib/device-status.ts`) computes offline at read time, but the raw column (read by KPIs and any non-effective consumer) is never reconciled, and nothing flags a device that drops off.

2A closes these for platform admins, reusing the existing command queue (`deviceCommand`), firmware release table, and `enqueueDeviceCommand` action.

## Decisions (locked via brainstorming)

1. **Offline detection = reconcile + alert, folded into the EXISTING daily health cron** (`/api/cron/health` → `evaluateAndPersistAlerts`) — no new Vercel cron (Hobby is near its cron limit). Flip `online → offline` when `lastSeenAt` is older than the staleness threshold `effectiveDeviceStatus` already uses (so read-time display and the DB column agree), **never touching `paused`**, and audit each flip.
2. **The offline *email* is deferred to 2B.** `computeAlerts` already raises a stale-device alert row (shown in the health banner); 2B wires the general alert → Resend delivery. 2A only reconciles the status, records the transition (audit), and relies on the existing alert row — it does NOT build a separate offline-email path.
3. **Command-queue pause is OUT of scope.** Pausing already works by setting `device.status="paused"` (the ingest gate rejects paused devices with 403); a `pause` command type would need a firmware contract change for no real gain. Keep the existing direct-write pause (`setDeviceActiveAdmin` / `DevicePauseControl`).
4. **CommandBar lives on the new admin device detail page**, not crammed into a fleet-table row.
5. **All admin device surfaces use `effectiveDeviceStatus`** for immediate read-time accuracy (the daily reconcile keeps the raw column honest for KPIs between read-time computations).

## Architecture

### A) Pure helpers — extend `lib/device-status.ts` (or a small `lib/devices/fleet.ts`)

```ts
// Already exists: effectiveDeviceStatus(status, lastSeenAt, now?) → "online"|"offline"|"paused"
// and its staleness threshold (e.g. STALE_MINUTES). Reuse that threshold below.

// Pure: should this device's stored status be reconciled to "offline"?
// True only when status === "online" AND lastSeenAt is older than the threshold.
// NEVER flips "paused" or already-"offline".
export function shouldMarkOffline(
  d: { status: string; lastSeenAt: Date | null },
  now: Date,
): boolean;

// Pure: is a newer firmware available for this device?
export function firmwareUpdateAvailable(
  deviceVersion: string | null,
  latestVersion: string | null,
): boolean;   // latest != null && deviceVersion !== latest
```

These hold the boundary logic so they unit-test without a DB.

### B) Offline reconciliation IO — in the health-cron path (`lib/alerts-sync.ts` `evaluateAndPersistAlerts`, or a small `lib/devices/offline-sweep.ts` it calls)

```ts
export async function reconcileOfflineDevices(now: Date): Promise<number>; // count flipped
```

`UPDATE device SET status='offline' WHERE status='online' AND last_seen_at < (now - threshold)` (`.returning(...)` for the flipped rows); `recordAudit` per flip (`actor system`, a new `AUDIT.deviceWentOffline = "device.went_offline"`, target device, metadata `{ lastSeenAt }`). Called once from `evaluateAndPersistAlerts` before/after `computeAlerts` so the daily health sweep both reconciles status and (via the existing stale-device signal) records the alert row. Idempotent: a device already `offline` won't match `status='online'`.

### C) Admin device detail page — `app/(admin)/admin/devices/[deviceId]/page.tsx` (new)

Platform-admin-gated (the admin layout already enforces `requirePlatformAdmin`). Loads the device + its store/tenant + latest firmware release + recent commands via a new data fn `getAdminDeviceDetail(deviceId)` (mirrors the tenant `getDeviceDetail`-style read but spans orgs). Renders:
- Header: device name/ID, **effective status** badge, owning **tenant** + **store** (links).
- Specs card: IP, connection type, **firmware version + "update available"** notice (when `firmwareUpdateAvailable`), `lastSeen`.
- **Pause/resume** (reuse the admin `setDeviceActiveAdmin` action via a control, or the existing `DeviceRowActions` pause path adapted).
- **CommandBar** (`components/devices/command-bar.tsx`, reused) — reboot / refresh / identify / firmware-update via `enqueueDeviceCommand` (already authorizes platform-admin).
- **Command history** table (type / status / queued-at / acked-at) — reuse the tenant page's rendering.

### D) Fleet table firmware column — `components/.../fleet-table.tsx` + its data source

- Add a **Firmware** column: `device.firmwareVersion` + an "update available" badge when `firmwareUpdateAvailable(device.firmwareVersion, latestFirmware.version)`. The fleet data fn passes the latest firmware version through (one extra read of `firmwareRelease` ordered by createdAt desc, shared across rows).
- Make the **Device ID** cell a link to `/admin/devices/[deviceId]`.
- Keep the existing search / customer / status filters and `DeviceRowActions` unchanged. Ensure the Status column uses `effectiveDeviceStatus` (verify; align if it reads the raw column).

## Data flow

```
Daily /api/cron/health → evaluateAndPersistAlerts(now):
  reconcileOfflineDevices(now)  → flip online→offline past threshold (+audit device.went_offline)
  computeAlerts(...)            → stale-device alert row (existing; email delivery = 2B)

Admin /admin/devices (FleetTable): rows show effectiveDeviceStatus + firmware + update badge;
  Device ID → /admin/devices/[deviceId]

Admin /admin/devices/[deviceId]: specs + firmware + CommandBar (enqueueDeviceCommand) + pause + history
```

## Error handling / edge cases

- **Reconcile never touches `paused`** (only `status='online'` rows match) — a paused device stays paused.
- **Idempotent sweep:** re-running flips nothing already `offline`.
- **Device comes back:** the device's own ingest/config poll sets `status='online'` + bumps `lastSeenAt` (existing behavior), so a reconciled-offline device self-heals on its next contact — no manual un-flip needed.
- **No firmware releases yet:** `firmwareUpdateAvailable(_, null)` → false (no badge), never a false "update available".
- **Unknown deviceId** on the admin detail page → graceful not-found.
- **CommandBar/pause from admin:** `enqueueDeviceCommand` and `setDeviceActiveAdmin` already gate on platform-admin/owner role; no new authz.

## Testing

- **Pure unit tests** (`lib/device-status.test.ts` or `lib/devices/fleet.test.ts`): `shouldMarkOffline` (online+stale → true; online+fresh → false; paused → false even if stale; offline → false; null lastSeenAt handling); `firmwareUpdateAvailable` (newer → true; equal → false; null latest → false).
- **Existing suite green** (`npm run test`) + `npm run build` + `npx tsc --noEmit`.
- **Manual UI check** (deferred, needs running app): `/admin/devices` shows the firmware column + badge and the Device-ID link; `/admin/devices/[id]` renders specs/firmware/CommandBar/history; issuing a command from the admin detail enqueues a `deviceCommand` row.
- **Cron reconcile** verified via the pure predicate test + a `curl` of `/api/cron/health` (deferred, with `CRON_SECRET`).

## Out of scope

- **2B:** alert *email* delivery (wiring `notifiedAt` → Resend), per-tenant health drill-down, customers-list health rollup.
- **2C:** audit-log UI polish.
- Command-queue-based pause (decision 3) and any firmware-contract change.
- A new standalone offline cron (folded into the existing health cron).

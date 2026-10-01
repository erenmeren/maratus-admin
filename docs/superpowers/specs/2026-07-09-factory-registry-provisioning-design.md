# Factory Registry & Serial-Based Provisioning — Design

**Date:** 2026-07-09
**Status:** Approved
**Scope:** maratus-admin (cloud) + maratus-firmware (one-line contract addition)

## Problem

Maratus will manufacture ~10,000 printer devices. Today a device only exists in the
cloud once a customer claims it (M6a device-first flow), which leaves no way to
track manufactured-but-unsold stock, production batches, RMAs, or grey/clone
units — and no zero-touch onboarding for pre-assigned installs. Fulfillment will
be mixed: some devices are self-claimed by customers, others are allocated to a
known customer and installed by Maratus or a partner.

Constraints agreed during brainstorming:

- **Mixed fulfillment** — both self-service claim and pre-allocated install must work.
- **Manufacturing process undecided** — the design must work whether a contract
  manufacturer flashes a common image or Maratus runs its own provisioning station.
- **Pragmatic security** — software device identity stays (key minted at claim,
  SHA-256 hash stored); no secure boot / flash encryption / per-device factory
  secrets in this iteration.
- **Cloud-side inventory** — every manufactured device is known to the cloud
  before it reaches a customer.

## Identity anchor: eFuse MAC as serial

The ESP32-P4's factory-burned eFuse base MAC (`esp_efuse_mac_get_default`) is the
device's immutable serial. Normalized form everywhere: **12 lowercase hex chars,
no separators** (e.g. `84f703aabbcc`). The box label QR encodes exactly this
string.

**Security principle: the serial is NOT a secret** (it is printed on the box).
It is used only for matching and inventory, never for authentication. The
device's credential remains the claim-minted device key.

## Data model

New table `factoryDevice` (`factory_device`):

| Column | Type | Notes |
|---|---|---|
| `serial` | text PK | normalized MAC |
| `batchCode` | text | production batch/lot |
| `hardwareRevision` | text | |
| `status` | enum | `manufactured \| allocated \| claimed \| rma \| retired` |
| `allocatedOrganizationId` | FK → organization, nullable | pre-assignment target |
| `allocatedStoreId` | FK → store, nullable | optional pre-assignment |
| `deviceId` | FK → device, nullable | live device row linked at claim |
| `unregistered` | boolean, default false | row was auto-created at claim, not imported |
| `manufacturedAt` / `importedAt` / `allocatedAt` / `claimedAt` | timestamps | |
| `notes` | text | |

Indexes: `status`, `allocatedOrganizationId`, `deviceId`.

`device` table gains `serial text` (nullable, **unique index**).

Status machine is one-way: `manufactured → allocated → claimed`; `rma`/`retired`
may be set from any state by a platform admin. Reverting `claimed → allocated`
is an explicit admin action reserved for reset/RMA-return re-provisioning.

## Registry population (three doors, one table)

1. **CSV import (primary).** Admin uploads `serial,batch,hw_rev,manufactured_at`
   at `/admin/inventory`. The CM's flash jig already reads the MAC via `esptool`;
   exporting a per-batch CSV is the only ask. Import is an idempotent upsert
   keyed on serial (re-import updates, never duplicates).
2. **Single add.** A barcode scanner types the label QR into a form field —
   covers an in-house incoming-QC station.
3. **Self-registration at claim (fallback).** A serial unknown to the registry
   that completes a claim gets a row auto-created with `status: claimed` and
   `unregistered: true`, surfaced with a "Not in factory registry" badge. The
   system works even with an empty registry. Rows are only auto-created after a
   successful, tenant-authorized claim — the unauthenticated claim-poll endpoint
   can never insert rows (DoS protection).

## Firmware change (contract addition only)

`cloud_claim_poll` appends the serial to the existing claim-poll URL:

```
GET /api/device/claim?code=XXXX-XXXX&serial=84f703aabbcc
```

MAC read from eFuse, formatted to the normalized form. No new endpoint, no new
screen. Optional nicety (non-blocking): render the serial in small type on the
setup screen for support calls.

## Claim endpoint decision logic

`GET /api/device/claim` stays unauthenticated + rate-limited. The pure decision
helper (`lib/provisioning.ts` `classifyClaimPoll`) is extended to take the
registry row; the decision table becomes:

| Code state | Serial state | Behavior |
|---|---|---|
| unknown code | registry `allocated` | **Auto-claim:** create device row bound to the allocated org (+store if set), mint key, registry → `claimed`, respond `{status:"claimed", deviceKey}` on this poll. Installer only connects Wi-Fi; no code entry. |
| unknown code | anything else | `{status:"pending"}` — wait for human claim (today's behavior). |
| claimed, key pending | any | Deliver key **once** (today's behavior); additionally stamp `device.serial`, link the registry row, registry → `claimed`. |
| claimed, key delivered | any | `{status:"claimed"}`, no key (today's behavior). |

Auto-claim mirrors the existing one-shot key-delivery semantics: the device row
is created with `pendingDeviceKey`, and the key is delivered and consumed in the
same response (a lost response leaves the device on the human-claim path, same
trade-off as today's flow).

**Hijack guard:** auto-claim fires only on the one-shot `allocated → claimed`
transition. A serial in `claimed` state never re-mints a key — the serial is
public, so anything else would allow device hijack by polling with a victim's
serial. A reset or RMA-returned device always goes through the human-approved
claim path (or an admin explicitly reverts the registry row to `allocated`).

**Trade-off (accepted):** during the allocated→installed window, a bare serial
(public, printed on the box) plus any well-formed pairing code auto-claims the
device key for that org. This is inherent to zero-touch provisioning under the
pragmatic-security constraint — the alternative is not-zero-touch. Mitigations:
the one-shot transition above (the window closes the instant the real device
claims), the `device.auto_claimed` audit event recorded on every auto-claim,
and, as a follow-up, a platform-admin alert on auto-claim plus a
hijack-recovery runbook (delete the rogue device, revert the registry row to
`allocated`).

Auto-claim additionally requires the allocation to include a store: an
allocation without a store stays on the human-claim path (the admin UI states
this), because a claimed device without a store is invisible to the
store-scoped device queries.

**Duplicate-serial corner:** if stamping `device.serial` hits the unique index
(same physical device reset and claimed a second time), the new row's serial is
left null, a `duplicate-serial` audit event is recorded, and the admin UI shows
a warning badge. Nothing is silently overwritten.

## Admin UI

- **`/admin/inventory`** (platform-admin only): registry list with batch /
  status / customer filters; CSV import; single add; **Allocate to customer**
  (serials → org + optional store, status → `allocated`); de-allocate (only
  while unclaimed); RMA marking; per-row QR render for label reprint.
- **Device detail:** shows serial + registry link; "Not in factory registry"
  warning for `unregistered` rows; `duplicate-serial` warning badge.
- Auto-claimed devices are named `Printer <last 4 of serial>` instead of
  "New Printer" so bulk installs stay distinguishable.

## Hardening (required at 10k scale)

- Add a **per-IP rate limit** to the claim endpoint (today only per-code
  30/min exists; add `claim-ip:` at 60/min).
- Server-side **pairing-code format validation** (8 chars from the firmware's
  32-char unambiguous alphabet) before any DB query.
- Entropy audit: 32⁸ ≈ 1.1×10¹² code space; ~10k live codes give collision
  probability ≈ 10⁻⁵ and guessing is impractical under rate limits → the
  existing code format is sufficient, unchanged.

## Testing

- Decision logic stays a pure function (existing `lib/provisioning.ts`
  pattern): unit tests for all decision-table branches, serial normalization,
  and CSV parse/idempotency.
- Migration: one migration — `factory_device` + `device.serial` + unique index.
  Trim the generated SQL to just this change (known drizzle snapshot-drift
  hazard).
- Firmware: host tests for URL composition + MAC formatting.

## Out of scope (deliberate YAGNI)

- Secure boot / flash encryption / hardware attestation (Approach B territory;
  this registry becomes its foundation if clone risk materializes).
- Label-printing integration (QR content is defined; printing is an external
  process).
- Tenant-facing inventory visibility (registry is platform-admin only).

## Alternatives considered

- **B — Full factory provisioning** (per-device key/cert written on a
  provisioning station): strongest identity, rejected for now — requires a
  provisioning station (manufacturing process undecided) and conflicts with the
  pragmatic-security choice. The registry is forward-compatible with it.
- **C — Status quo + external spreadsheet inventory**: cheapest, rejected — no
  serial↔cloud link means no auto-claim, no clone detection, no RMA tracking.

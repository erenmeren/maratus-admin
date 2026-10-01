# Trigger-only Device — Strip the Document / Print / R2-Ingest Stack

**Date:** 2026-07-02
**Status:** Draft — awaiting user review
**Author:** Eren (via brainstorming session)

## Problem / Motivation

Maratus today has **two** ways a device produces a customer-facing QR:

1. **Legacy print/ingest flow** — the device renders a document (ESC/POS-style image),
   `POST /api/ingest` uploads it to R2, a `document` row + token is created, and the
   public `/r/{token}` or `/d/{token}` page serves the image. Phases 3A–3C
   (branded page, return/warranty window, email-me-this-document, magic-link
   recovery, marketing contacts) are all built on top of this.
2. **Trigger flow** — `POST /api/v1/devices/{deviceId}/trigger` enqueues a
   `show_qr` command with a caller-supplied URL; the device renders a QR from it,
   ACKs, and 1 prepaid credit settles.

We are dropping flow (1) entirely. **The cloud's only job becomes: receive a
trigger request and have the device display a QR from the caller's URL.**
Customers who want a document host it themselves and pass us its URL. No
document is created, stored, or served by Maratus.

## Goals

- Keep exactly one device-activation path: the **existing** trigger API,
  **contract unchanged**.
- Do **not** alter the trigger endpoint's request body — it stays exactly as
  shipped (`{ action: "show_qr", payload: { url } }`, deviceId in the path). Reuse
  the existing implementation; refactor internals only if a deletion forces it.
- Remove the document subsystem and everything Phase 3A–3C built on it.
- Do **not** break the already-shipped Spec-B firmware (it parses the internal
  `show_qr` command payload).
- Keep prepaid **credits + Stripe top-ups** as the live payment path.

## Non-Goals

- **Billing rework.** The per-print invoice/dunning machinery (`billing-engine.ts`,
  `invoice` table, `billing/billing-cron.ts`, Phase 1C transition emails) is left
  **in place, untouched**, per explicit decision. With no documents created it
  meters $0 until a later, dedicated billing pass. Consequently the `document`
  table itself is **kept (vestigial)** so billing keeps compiling.
- **Firmware repo (`maratus-firmware`).** Its receipt-render/upload/print pipeline
  becomes dead code but is out of scope for this repo's spec; strip it there
  separately.

## Design

### 1. Trigger API — reuse the existing endpoint, contract UNCHANGED

We already shipped the trigger flow. It is **kept exactly as-is** — same route,
same request body, same behavior. No new endpoint, no body change.

- **Endpoint (unchanged):** `POST /api/v1/devices/{deviceId}/trigger`
  (`app/api/v1/devices/[deviceId]/trigger/route.ts`), `deviceId` in the path.
- **Request body (unchanged):** `{ "action": "show_qr", "payload": { "url": string } }`
  — validated by the existing `validateTriggerBody` in `lib/trigger-actions.ts`
  (`isValidUrl`, ≤ 2048 chars). Do **not** change this shape.
- **Preserved behavior (all kept):** API-key auth via `guardApiRequest`,
  `devices:trigger` scope check, required `Idempotency-Key` header + idempotency
  replay, credit reserve→settle→release, `device_not_found`/`device_offline`/
  `insufficient_credits` error paths, 60s command TTL, lazy expired-hold
  reconciliation, and the internal device command `{ action:"show_qr",
  payload:{ url } }` the shipped firmware parses.
- **Refactor only if forced:** the trigger route/`lib/trigger-actions.ts` have no
  dependency on any code removed in §2, so in practice **no change is expected**.
  Touch them only if a deletion elsewhere makes it necessary, and even then keep
  the public contract identical.
- **OpenAPI:** leave any existing trigger entry as-is; only the document endpoints
  are removed from `openapi.json` (see §2).

### 2. Remove the document subsystem

**Routes / endpoints removed:**
- `app/api/ingest/`
- `app/api/v1/documents/` and `app/api/v1/documents/[id]/`
- `app/(public)/d/[token]/` and the entire `/d/lookup/*` recovery flow
  (note: there is no `/r/[token]` route in the live tree — already gone)

**Lib removed:**
- `lib/documents.ts`, `lib/documents-search.ts`, `lib/lookup/*`
- document-specific view-model functions in `lib/data.ts`
  (`getDocument*`, `listDocumentsByCursor`, document counts/series helpers, etc.)
- the `putDocument` / `presignedDocumentUrl` aliases in `lib/storage.ts`
  (R2 core — `putObject`, `presignedGetUrl`, `deleteObject` — **stays**; it still
  serves logos, firmware binaries, and printer-config icons)
- `lib/api/serialize.ts` document serializer (if unused elsewhere)

**Phase 3A–3C features removed** (all sit on the document / `/d` page):
branded document page, return/warranty window, email-me-this-document,
magic-link recovery, marketing contacts.

**Webhook subsystem removed** (added during planning — not vestigial). The webhook
feature's only event types are `document.created` / `document.downloaded`, its
`events.ts` imports `serializeDocumentRow` (→ `DocumentStatus` from
`documents-search`), and both emitters (ingest, the `/d` page) are being deleted.
Unlike billing — which only needs the `document` *table* to stay — keeping
webhooks would force us to retain live document application code (serializer +
status type + event builder). So the whole subsystem is deleted: `lib/webhooks/**`,
`lib/actions/webhooks.ts`, the two `components/webhook-*.tsx`, the tenant
`/tenant/webhooks` page, `app/api/cron/webhooks/route.ts` (+ its cron schedule),
and the `webhookEndpoint` + `webhookDelivery` tables. *(Flagged for confirmation;
this is the one item beyond the originally-approved spec.)*

**Schema / migration:**
- Drop tables `documentContact`, `marketingContact`, `lookupToken` (Phase-3
  additions), and `webhookEndpoint` + `webhookDelivery` (webhook subsystem).
- Drop the Phase-3 `tenantSettings` columns that only fed the `/d` page:
  `supportEmail`, `supportUrl`, `returnWindowDays`, `warrantyPeriodMonths`.
  **Keep** the branding columns (`logoUrl`, `brandColor`, `brandBg/Fg/Muted`) —
  they also drive the device idle/QR screen.
- **Keep** the `document` table definition (billing dependency) and the
  `usageEvent` table (billing/usage, untouched).
- New Drizzle migration; strip generated SQL to just these drops
  (per the known snapshot-drift gotcha).

**Tenant / admin UI:**
- Remove `/tenant/documents` (list, `[documentId]` detail, search).
- Remove the tenant marketing-contacts page and document-recovery surfaces.
- **Metrics — repoint to QR triggers (separate follow-up plan).** The dashboard
  count/series queries read the `document` table directly; because that table is
  **kept vestigial**, they keep compiling and simply return **0** after the
  teardown. Repointing them to trigger counts (source of truth = the **credit
  ledger** — settled `show_qr` charges; `deviceCommand` type=`trigger` as the
  fallback for pending/failed breakdowns) touches ~12 UI files + `lib/data.ts` +
  `lib/types.ts` + `components/charts.tsx` and is its own testable unit. It is
  therefore carved into a **follow-up plan**, not this teardown. Nav links to the
  dead document/contacts pages ARE removed here so nothing 404s.

### 3. Billing — unchanged (explicit decision)

`billing-engine.ts`, `invoice` table, `billing/billing-cron.ts`, dunning, and
Phase 1C transition emails are **left as-is**. They read the (now-empty)
`document` table and meter $0 until the separate billing pass. `perPrintPriceCents`
stays in the schema for the same reason. Prepaid **credits + Stripe credit-pack
top-ups** remain the live payment path (each trigger charges 1 credit).

### 4. Kept unchanged

Device claim / commands / ACK / config / firmware / OTA; prepaid credit ledger,
holds, and credit-holds cron; R2 core (non-document assets); branding/logo;
**printer-display config** (`printer-layout` / `printer-geometry` / `printer-icons`
+ `device-config`) — the device still renders a *branded QR screen*, which is
display config, not document printing *(DEFAULT — keep; revertible on review)*;
stores; audit log; auth / orgs; health + usage crons.

## Data Flow (after)

```
External system                Maratus cloud                     Device
---------------                -----------                     ------
POST /api/v1/devices/{deviceId}/trigger
  { action:"show_qr",
    payload:{ url:"https://host/doc" } }
        ──────────────────────▶  auth + scope + idempotency
                                 reserve 1 credit
                                 insert deviceCommand
                                   { action:"show_qr",
                                     payload:{ url } }
                                 202 { id, status:"queued" }
                                                        ◀── GET /api/device/commands (poll)
                                                            render QR from url
                                                        ── POST .../ack ──▶ settle credit
```

## Error Handling

Unchanged from the current trigger route — `invalid_request` (bad body/URL),
`missing_idempotency_key`, `insufficient_scope`, `device_not_found`,
`device_offline`, `insufficient_credits`, `conflict`, `internal_error`.

## Testing

- **Trigger tests unchanged:** `lib/trigger-actions.test.ts` stays as-is (the
  contract is not changing). The existing trigger/credit suites remain the
  regression guard for the kept path.
- **Remove:** ingest, document, lookup, Phase-3, and marketing-contacts test
  suites alongside their code. Overall test count will drop from 332.
- **Keep:** credit ledger/holds, device-command/config/status, API-scope, and
  billing tests (billing untouched).

## Risks / Open Questions

- **Vestigial `document` table + billing metering $0** is a deliberate interim
  state; flagged so the later billing pass is not forgotten.
- Confirm which `tenantSettings` columns are safe to drop (only `/d`-page-facing
  ones) vs. those reused by the device QR-screen branding.
- The two "away" defaults (repoint metrics to triggers; keep printer-display
  config) are marked inline and should be confirmed at review.

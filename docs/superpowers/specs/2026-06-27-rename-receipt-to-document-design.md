# Rename "Receipt" → "Document" (Cloud, Spec 1) — Design

**Date:** 2026-06-27
**Repo:** `maratus-admin` (cloud). Firmware is **Spec 2** (follow-up).
**Status:** Approved design, pre-implementation

## Problem

The device is a general-purpose printer that can print anything, but the product, code, DB, API, and UI all call the printed artifact a "receipt". Rebrand the concept to **Document** everywhere — including external contracts (the project isn't serving real integrators yet: Stripe is in test mode and the only device is the dev board, so a clean break is acceptable).

## Decisions (locked via brainstorming)

1. **Total rename, no back-compat.** User-facing text, internal code, DB schema, public API, webhooks, the QR route, and the Stripe meter all become "document".
2. **Term:** `Document`/`Documents` (UI), `document`/`documentId`/`document_id` (code/DB), `document.created`/`document.downloaded` (webhooks).
3. **QR route:** hard rename `/r/[token]` → `/d/[token]`, **no redirect** (old test-printed QR codes will 404 — acceptable).
4. **Public API:** hard rename `/api/v1/receipts` → `/api/v1/documents`, **no alias** (404 on the old path).
5. **Stripe meter:** `STRIPE_METER_EVENT_NAME` default → `"documents"`; **the user reconfigures the Stripe dashboard meter's `event_name` to match** (ops step — otherwise metering silently stops; test mode, low risk).
6. **Historical dated docs** under `docs/superpowers/` keep their original "receipt" wording (point-in-time records, per the kiosk→printer precedent). Only living docs (`CLAUDE.md`, `AGENTS.md`) are updated.
7. **`/api/ingest`** endpoint name stays (it's "ingest", contains no "receipt"). `tenantSettings.perPrintPriceCents` stays (no "receipt" in the name).

## Scope of change

~90 `.ts/.tsx` files contain "receipt"; ~12 paths have "receipt" in their **name** (need `git mv`); plus the public `/r/` route. Schema has ~20 hits.

### A) DB schema + migration (`lib/db/schema.ts`, `lib/db/relations.ts`, `drizzle/0023_*.sql`)

Renames (Postgres `RENAME` is metadata-only — instant, data-preserving):
- Table `receipt` → `document`. Its indexes `receipt_token_idx`/`receipt_organization_id_idx`/`receipt_device_id_idx`/`receipt_store_id_idx`/`receipt_created_at_idx` → `document_*`.
- `usage_event.receipt_id` → `document_id`; unique index `usage_event_receipt_id_idx` → `usage_event_document_id_idx`; the FK `→ receipt.id` becomes `→ document.id`.
- `invoice.receipt_count` → `document_count`.
- Drizzle exports/relations: `export const receipt` → `document`; `relations.ts` `receipt`/`receiptRelations` → `document`/`documentRelations`; `usageEvent.receiptId` → `documentId`.
- **Migration authoring:** `npm run db:generate` may emit a drop+create for a table rename (data loss). The migration MUST be **hand-written** as `ALTER TABLE "receipt" RENAME TO "document";`, `ALTER TABLE "usage_event" RENAME COLUMN "receipt_id" TO "document_id";`, `ALTER INDEX ... RENAME TO ...;`, `ALTER TABLE "invoice" RENAME COLUMN "receipt_count" TO "document_count";` — verify the generated SQL and replace any DROP/CREATE with RENAMEs before applying. Update `drizzle/meta` snapshot to match (regenerate after the schema edit, then swap the SQL body).

### B) Internal code identifiers (`lib/`, `app/`, `components/`, tests)

Mechanical rename of identifiers + file/dir names:
- Files/dirs (`git mv`): `lib/receipts.ts`→`lib/documents.ts`, `lib/receipts-search.ts`→`lib/documents-search.ts` (+ its test), `components/receipts/`→`components/documents/` (and the three `receipt-*.tsx` files), `app/(admin)/admin/receipts/`→`documents/` (+ `[receiptId]`→`[documentId]`), `app/(tenant)/tenant/receipts/`→`documents/` (+ `[receiptId]`→`[documentId]`), `app/api/v1/receipts/`→`documents/`, `app/(public)/r/[token]/`→`app/(public)/d/[token]/`.
- Identifiers (examples; rename ALL): `listReceiptsByCursor`→`listDocumentsByCursor`, `serializeReceiptRow`→`serializeDocumentRow`, `ApiReceiptRow`/`ReceiptRow`/`ReceiptMetadata`→`Document*`, `receiptToken`→`documentToken`, `recordUsageEvent({receiptId})`→`{documentId}`, `reportReceiptUsage`→`reportDocumentUsage`, `ReceiptFilters`→`DocumentFilters`, alert ids `"receipts-stuck"`→`"documents-stuck"` etc. Update all imports.

### C) Public API + routes + OpenAPI

- `app/api/v1/documents/route.ts` + `[id]/route.ts` (moved). Response **JSON field names** that carry "receipt" → "document"; the `data` array of serialized documents (`serializeDocumentRow`). The `device_id` filter param stays.
- `app/api/v1/usage/route.ts` — "receipt"-named fields/counts → document.
- `app/api/v1/openapi.json/route.ts` — paths (`/receipts`→`/documents`), schema names, descriptions.
- Public token page `app/(public)/d/[token]/page.tsx` (moved) — copy + the not-found text. The ingest route (`app/api/ingest/route.ts`) returns `url = \`${BETTER_AUTH_URL}/d/${token}\``.

### D) Webhooks (`lib/webhooks/`)

- `WEBHOOK_EVENT_TYPES = ["document.created","document.downloaded"]`; `isWebhookEventType`, `buildEvent`, the delivered payload (reuses the API document shape), and `lib/webhooks/deliver.ts` (`deliverEvent(... "document.created", document)`). Update tests.

### E) Stripe meter (`lib/env.ts`, billing)

- `STRIPE_METER_EVENT_NAME: z.string().default("documents")`. `meterEventPayload`/`reportDocumentUsage` comments. Update the billing test that asserts `"receipts"`. **Ops:** reconfigure the Stripe meter (user).

### F) UI strings, emails, printer-screen defaults, docs

- Every visible "Receipt"/"Receipts" → "Document"/"Documents": tenant + admin pages, nav/sidebar labels, KPI labels ("Receipts this month"→"Documents this month"), the `components/documents/` table/detail/filters, the public page ("Your receipt is ready"→"Your document is ready"), alert emails (`lib/alerts-sync.ts`), the seeded printer-screen text in `lib/printer-layout.ts` (`seededScreen`: "Scan to get your receipt"→"…document", "Preparing your receipt…"→"…document", etc.) and any default-copy in `printer-preview.tsx`.
- `CLAUDE.md` / `AGENTS.md`: the product description + the "digital-receipt" framing → "digital-document"; data-model + ingest sections.

## Error handling / risks

- **Deploy ordering** (`.env.local` IS prod): the table rename and the deployed code must land together. Plan: run `npm run db:migrate` (the rename) and `vercel --prod` back-to-back; a few seconds of inconsistency on a single-tenant test app is acceptable. (No code path tolerates the table being half-renamed, so don't deploy new code long before migrating, or vice-versa.)
- **Find/replace discipline:** rename respecting case variants (`Receipt`, `receipt`, `receipts`, `Receipts`, `receiptId`, `receipt_id`, `receipt.created`). Do NOT touch: `node_modules`, `.next`, `drizzle/meta` JSON except via regeneration, historical `docs/superpowers/` specs/plans, or git history.
- **Old QR codes 404** by decision (no `/r/` redirect). Old `/api/v1/receipts` 404 by decision.

## Testing

- Pure suite (`npm run test`) updated and green (webhook-events, billing-status meter name, receipts-search→documents-search, serialize, etc.).
- `npm run build` + `npx tsc --noEmit` clean.
- **Grep gate:** after the rename, `grep -rinE "receipt" lib app components --include=*.ts --include=*.tsx` returns **zero** (any remaining hit is a bug, except deliberately-kept historical docs which are excluded).
- **Live smoke** (post-migrate + deploy): `/api/v1/documents` returns data (scoped key); `/api/v1/receipts` → 404; the public `/d/{token}` page renders an existing document and flips `ready→downloaded`; webhook event types are `document.*`; UI shows "Documents"; a fresh ingest returns a `/d/{token}` url.

## Out of scope (→ Spec 2, firmware)

- `maratus-firmware`: rename receipt→document in `render_job`, `cloud_post_receipt`, dev-state/comments, any on-screen strings; HIL. (The device renders whatever the cloud sends; the cloud's `/d/{token}` URL change is forward-compatible — the device just prints the returned url into a QR.)
- Reconfiguring the Stripe dashboard meter `event_name` (user ops step).

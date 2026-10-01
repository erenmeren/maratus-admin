# Trigger-only Device Teardown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the Maratus cloud to a single device-activation path (the existing credit-metered `trigger` API, **contract unchanged**), deleting the entire document / print / R2-ingest subsystem, all Phase 3A–3C features, and the (document-only) webhook subsystem.

**Architecture:** The `trigger` endpoint and its request body stay exactly as shipped — everything that creates, stores, serves, or notifies about documents is removed around it. The `document` and `usageEvent` tables are **kept vestigial** so the billing/usage code (explicitly left alone) keeps compiling and simply meters $0.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript strict, Drizzle ORM over Neon Postgres, Better Auth, Cloudflare R2, Vitest.

## Global Constraints

- **Reference spec:** `docs/superpowers/specs/2026-07-02-trigger-only-device-design.md` (verbatim source of truth).
- **Branch:** `refactor/trigger-only-device` (already checked out).
- **Trigger contract is FROZEN.** Do NOT change `app/api/v1/devices/[deviceId]/trigger/route.ts`, `lib/trigger-actions.ts`, or `lib/trigger-actions.test.ts` — the request body stays `{ action:"show_qr", payload:{ url } }` and the internal device command stays identical. These files have no dependency on anything removed here, so they should need no edits at all. If a deletion somehow forces a touch, keep the public contract and the `show_qr`/`payload.url` shape byte-for-byte identical.
- **KEEP vestigial, do NOT touch:** the `document` table, the `usageEvent` table, `lib/billing/**`, `lib/billing-engine.ts`, the `invoice` table, `perPrintPriceCents`, `getApiUsage`/`serializeUsage`/`app/api/v1/usage`, and the credit ledger / holds.
- **KEEP unchanged:** device claim/commands/ack/config/firmware/OTA, credits, R2 core (`putObject`/`presignedGetUrl`/`deleteObject` + logo/icon/image/firmware storage-key helpers), branding/logo (`lib/branding-shell.ts`, `components/branding-editor.tsx`, `tenantSettings.logoUrl`/`brandColor`/`brandBg`/`brandFg`/`brandMuted`), stores, audit log, auth/orgs, health + usage crons.
- **Deletion ordering rule:** always delete *importers* before *producers* — `next build` typechecks the whole project, so any dangling import fails the build. Every task ends with a green build + test suite.
- **Verification per task:** `npm run build` (webpack) passes AND `npm test` (vitest run) passes AND a targeted grep shows no dangling references, THEN commit.
- **Line numbers below are from the map at planning time and will drift as edits land — locate code by the named symbol, not the line number.**
- **Metric repoint is OUT OF SCOPE** here (separate follow-up plan). Dashboards keep reading the vestigial `document` table and will show 0. Do not modify dashboard/analytics/report count-and-series queries.

---

### Task 1: Delete the webhook subsystem

Webhooks only ever carry `document.*` events and `events.ts` imports `serializeDocumentRow`. Delete the whole feature. `serializeDocumentRow` stays for now (still used by the v1 documents API, removed in Task 3).

**Files:**
- Delete: `lib/webhooks/deliver.ts`, `lib/webhooks/sign.ts`, `lib/webhooks/sign.test.ts`, `lib/webhooks/retry.ts`, `lib/webhooks/retry.test.ts`, `lib/webhooks/url-guard.ts`, `lib/webhooks/url-guard.test.ts`, `lib/webhooks/events.ts`, `lib/webhooks/events.test.ts` (the whole `lib/webhooks/` dir)
- Delete: `lib/actions/webhooks.ts`
- Delete: `components/webhook-row-actions.tsx`, `components/webhook-create-dialog.tsx`
- Delete: `app/(tenant)/tenant/webhooks/page.tsx` (and the `webhooks/` dir)
- Delete: `app/api/cron/webhooks/route.ts` (and the `cron/webhooks/` dir)
- Modify: `lib/nav.ts` — remove the "Webhooks" → `/tenant/webhooks` nav entry
- Modify: `vercel.json` (or `vercel.ts`) — remove the `/api/cron/webhooks` cron schedule if present

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (pure removal).

- [ ] **Step 1: Delete the webhook files and directories**

```bash
git rm -r lib/webhooks
git rm lib/actions/webhooks.ts
git rm components/webhook-row-actions.tsx components/webhook-create-dialog.tsx
git rm -r "app/(tenant)/tenant/webhooks"
git rm -r app/api/cron/webhooks
```

- [ ] **Step 2: Remove the "Webhooks" nav entry**

In `lib/nav.ts`, delete the object whose `href` is `/tenant/webhooks` (labelled "Webhooks").

- [ ] **Step 3: Remove the webhooks cron schedule**

Run: `grep -rn "cron/webhooks" vercel.json vercel.ts 2>/dev/null`
If found, delete that cron entry from the crons array. If no match, skip.

- [ ] **Step 4: Verify no dangling references to the webhook code**

Run: `grep -rn "lib/webhooks\|actions/webhooks\|webhook-row-actions\|webhook-create-dialog\|buildEvent\|WEBHOOK_EVENT\|deliverWebhook\|/tenant/webhooks" app lib components --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v worktrees`
Expected: no results. (`webhookEndpoint` / `webhookDelivery` schema tables still exist — they are dropped in Task 7. `app/api/stripe/webhook` is unrelated and stays.)

- [ ] **Step 5: Build + test**

Run: `npm run build && npm test`
Expected: both PASS (some webhook `*.test.ts` files are gone, so the test count drops).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove document-only webhook subsystem"
```

---

### Task 2: Delete the tenant + admin document UI pages

These pages are the only consumers of the document-list/detail data-layer functions and the `components/documents/` widgets. Deleting them leaves those functions as unused exports (fine — removed in Task 6).

**Files:**
- Delete: `app/(tenant)/tenant/documents/page.tsx`, `app/(tenant)/tenant/documents/[documentId]/page.tsx` (whole `tenant/documents/` dir)
- Delete: `app/(admin)/admin/documents/page.tsx`, `app/(admin)/admin/documents/[documentId]/page.tsx` (whole `admin/documents/` dir)
- Delete: `components/documents/document-detail.tsx`, `components/documents/document-filters.tsx`, `components/documents/documents-table.tsx` (whole `components/documents/` dir)
- Modify: `lib/nav.ts` — remove both "Documents" entries (`/admin/documents` and `/tenant/documents`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (pure removal).

- [ ] **Step 1: Delete the pages and components**

```bash
git rm -r "app/(tenant)/tenant/documents"
git rm -r "app/(admin)/admin/documents"
git rm -r components/documents
```

- [ ] **Step 2: Remove the two "Documents" nav entries**

In `lib/nav.ts`, delete the entries whose `href` is `/admin/documents` and `/tenant/documents`.

- [ ] **Step 3: Verify no dangling references**

Run: `grep -rn "components/documents\|/tenant/documents\|/admin/documents\|DocumentsTable\|DocumentFilters\|DocumentDetail" app lib components --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v worktrees`
Expected: no results.

- [ ] **Step 4: Build + test**

Run: `npm run build && npm test`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove tenant + admin document UI pages"
```

---

### Task 3: Delete the public v1 documents API + its keyset-pagination helpers

`lib/api/cursor.ts` and `lib/api/params.ts` are used **only** by this route (verified). `serializeDocumentRow`/`serializeDocumentDetail` and `listDocumentsByCursor` become unused after this (removed in Task 6).

**Files:**
- Delete: `app/api/v1/documents/route.ts`, `app/api/v1/documents/[id]/route.ts` (whole `api/v1/documents/` dir)
- Delete: `lib/api/cursor.ts`, `lib/api/cursor.test.ts`, `lib/api/params.ts`, `lib/api/params.test.ts`
- Modify: `app/api/v1/openapi.json` — remove the `/documents` + `/documents/{id}` path entries and any document schema definitions (leave `/devices/{deviceId}/trigger` and `/usage`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (pure removal).

- [ ] **Step 1: Delete the route + helpers**

```bash
git rm -r app/api/v1/documents
git rm lib/api/cursor.ts lib/api/cursor.test.ts lib/api/params.ts lib/api/params.test.ts
```

- [ ] **Step 2: Prune `openapi.json`**

Run: `grep -n "documents\|Document" app/api/v1/openapi.json`
Remove the `/documents` and `/documents/{id}` path objects and any now-orphaned document component schemas. Validate it is still valid JSON:
Run: `node -e "JSON.parse(require('fs').readFileSync('app/api/v1/openapi.json','utf8')); console.log('valid json')"`
Expected: `valid json`.

- [ ] **Step 3: Verify no dangling references to the helpers**

Run: `grep -rn "api/cursor\|api/params\|parseListParams\|decodeCursor\|encodeCursor\|v1/documents" app lib --include="*.ts" | grep -v node_modules | grep -v worktrees`
Expected: no results.

- [ ] **Step 4: Build + test**

Run: `npm run build && npm test`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove public v1 documents API + pagination helpers"
```

---

### Task 4: Delete Phase 3A–3C (public /d page, recovery, contacts, coverage/support, email-me)

Removes the branded document page, magic-link recovery, marketing contacts, return/warranty window, support-contact, and email-me-this-document features. After this, `getMarketingContacts` and the `documents.ts` public-document region are unused.

**Files:**
- Delete: `app/(public)/d/[token]/page.tsx`
- Delete: `app/(public)/d/lookup/actions.ts`, `app/(public)/d/lookup/[orgId]/page.tsx`, `app/(public)/d/lookup/[orgId]/[token]/page.tsx` (whole `d/lookup/` dir; then remove the now-empty `app/(public)/d/` dir)
- Delete: `lib/lookup/store.ts`, `lib/lookup/token.ts`, `lib/lookup/token.test.ts`, `lib/lookup/normalize.ts`, `lib/lookup/normalize.test.ts`, `lib/lookup/email-templates.ts`, `lib/lookup/email-templates.test.ts` (whole `lib/lookup/` dir)
- Delete: `lib/branding/coverage.ts`, `lib/branding/coverage.test.ts`, `lib/branding/support.ts`, `lib/branding/support.test.ts`
- Delete: `app/(tenant)/tenant/branding/coverage-actions.ts`, `app/(tenant)/tenant/branding/support-actions.ts`
- Delete: `app/(tenant)/tenant/contacts/page.tsx`, `app/(tenant)/tenant/contacts/export-action.ts` (whole `tenant/contacts/` dir)
- Delete: `components/document-email-form.tsx`, `components/lookup-request-form.tsx`, `components/lookup-confirm.tsx`, `components/lookup-document-list.tsx`, `components/lookup-shell.tsx`, `components/support-contact-form.tsx`, `components/coverage-window-form.tsx`, `components/contacts-export-button.tsx`
- Modify: `app/(tenant)/tenant/branding/page.tsx` — remove the `SupportContactForm` and `CoverageWindowForm` imports + their rendered blocks (keep the rest of the branding page)
- Modify: `app/api/cron/health/route.ts` — remove the `reapExpiredLookupTokens` import and its call (keep the rest of the health cron)
- Modify: `lib/data.ts` — remove `getMarketingContacts` (and its `MarketingContact`-shaped return interface if local to it)
- Modify: `lib/documents.ts` — remove the public-document region: the `presignedDocumentUrl` import (keep `presignedGetUrl`), `interface PublicDocument`, `getDocumentByToken`, `getDocumentByTokenMeta`. **KEEP** `interface ClaimResult`, `claimDevice`, `getUnclaimedDevices`.
- Modify: `lib/nav.ts` — remove the "Contacts" → `/tenant/contacts` entry

**Interfaces:**
- Consumes: nothing.
- Produces: `lib/documents.ts` continues to export `claimDevice`, `getUnclaimedDevices`, `ClaimResult` (unchanged; still used by `app/(tenant)/tenant/stores/[storeId]/`).

- [ ] **Step 1: Delete the feature files**

```bash
git rm -r "app/(public)/d"
git rm -r lib/lookup
git rm lib/branding/coverage.ts lib/branding/coverage.test.ts lib/branding/support.ts lib/branding/support.test.ts
git rm "app/(tenant)/tenant/branding/coverage-actions.ts" "app/(tenant)/tenant/branding/support-actions.ts"
git rm -r "app/(tenant)/tenant/contacts"
git rm components/document-email-form.tsx components/lookup-request-form.tsx components/lookup-confirm.tsx components/lookup-document-list.tsx components/lookup-shell.tsx components/support-contact-form.tsx components/coverage-window-form.tsx components/contacts-export-button.tsx
```

- [ ] **Step 2: Trim `app/(tenant)/tenant/branding/page.tsx`**

Remove the two import lines for `SupportContactForm` and `CoverageWindowForm` and the JSX blocks that render them. Leave the logo/brand-color/printer-preview sections intact.

- [ ] **Step 3: Un-wire the lookup-token reaper from the health cron**

In `app/api/cron/health/route.ts`, remove the `import { reapExpiredLookupTokens } ...` line and the line that calls it. Leave every other health-cron step unchanged.

- [ ] **Step 4: Remove `getMarketingContacts` from `lib/data.ts`**

Delete the `getMarketingContacts` function (and any interface defined solely for its return value). Do not touch any other function.

- [ ] **Step 5: Remove the public-document region from `lib/documents.ts`**

Delete the `presignedDocumentUrl` import (keep `presignedGetUrl`), `interface PublicDocument`, `getDocumentByToken`, and `getDocumentByTokenMeta`. Keep `ClaimResult`, `claimDevice`, `getUnclaimedDevices`.

- [ ] **Step 6: Remove the "Contacts" nav entry** in `lib/nav.ts`.

- [ ] **Step 7: Verify no dangling references**

Run:
```bash
grep -rn "lib/lookup\|branding/coverage\|branding/support\|coverage-actions\|support-actions\|/tenant/contacts\|getMarketingContacts\|getDocumentByToken\|getDocumentByTokenMeta\|PublicDocument\|reapExpiredLookupTokens\|DocumentEmailForm\|LookupShell\|CoverageWindowForm\|SupportContactForm\|coverageStatus\|supportLinks\|(public)/d/" app lib components --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v worktrees
```
Expected: no results.

- [ ] **Step 8: Build + test**

Run: `npm run build && npm test`
Expected: both PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: remove Phase 3A-3C (public doc page, recovery, contacts, coverage/support)"
```

---

### Task 5: Delete the ingest endpoint + R2 document storage path

Removes the device→R2 upload endpoint and the ingest guardrail libs. `putDocument`/`presignedDocumentUrl`/`documentStorageKey` become unused (their only other caller, `documents.ts`, was trimmed in Task 4).

**Files:**
- Delete: `app/api/ingest/route.ts` (and the `api/ingest/` dir)
- Delete: `lib/ingest-metadata.ts`, `lib/ingest-metadata.test.ts`, `lib/ingest-validation.ts`, `lib/ingest-validation.test.ts`
- Modify: `lib/storage.ts` — remove the document region: `putDocument`, `presignedDocumentUrl`, `documentStorageKey`, and the section comment. **KEEP** `putObject`, `presignedGetUrl`, `deleteObject`, `logoStorageKey`, `iconStorageKey`, `imageStorageKey`, `firmwareStorageKey`.

**Interfaces:**
- Consumes: nothing.
- Produces: `lib/storage.ts` continues to export the core + branding + firmware helpers listed above.

- [ ] **Step 1: Delete the ingest endpoint + libs**

```bash
git rm -r app/api/ingest
git rm lib/ingest-metadata.ts lib/ingest-metadata.test.ts lib/ingest-validation.ts lib/ingest-validation.test.ts
```

- [ ] **Step 2: Remove the document region from `lib/storage.ts`**

Delete `putDocument`, `presignedDocumentUrl`, `documentStorageKey`, and their section comment. Confirm the kept exports remain.

- [ ] **Step 3: Verify no dangling references**

Run: `grep -rn "api/ingest\|ingest-metadata\|ingest-validation\|putDocument\|presignedDocumentUrl\|documentStorageKey" app lib --include="*.ts" | grep -v node_modules | grep -v worktrees`
Expected: no results. (The `observability.test.ts` string literal `"api/ingest"` is just a test tag for `reportError` — leave it; it is not an import. Confirm the only remaining hits, if any, are that test tag.)

- [ ] **Step 4: Build + test**

Run: `npm run build && npm test`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove device ingest endpoint + R2 document storage path"
```

---

### Task 6: Remove the now-unused document read/serialize/search code

After Tasks 1–5, these producers have no consumers left. Delete them and their tests.

**Files:**
- Delete: `lib/documents-search.ts`, `lib/documents-search.test.ts`
- Modify: `lib/api/serialize.ts` — remove `serializeDocumentRow`, `serializeDocumentDetail`, and the `import { ... DocumentStatus } from "@/lib/documents-search"`. **KEEP** `serializeUsage` (and the `ApiUsage`-shaped input it reads).
- Modify: `lib/api/serialize.test.ts` — remove the `serializeDocumentRow` / `serializeDocumentDetail` describe blocks; keep the `serializeUsage` block.
- Modify: `lib/data.ts` — remove the document read/search functions: `interface DocumentListRow`, `documentConditions`, `searchDocuments`, `getDocumentDetail`, `getDocumentFilterOptions`, `interface ApiDocumentFilters`, `listDocumentsByCursor`. **KEEP** every dashboard/analytics/health count-and-series query that reads `documentTable` (they stay vestigial per the spec), `getApiUsage`, `getCreditUsageByDevice`, `getCreditUsageAllOrgs`, and the `claimDevice`/`getUnclaimedDevices` re-export.

**Interfaces:**
- Consumes: nothing.
- Produces: `lib/api/serialize.ts` continues to export `serializeUsage`; `lib/data.ts` keeps all non-document-UI exports.

- [ ] **Step 1: Remove the serializer document functions**

In `lib/api/serialize.ts`, delete `serializeDocumentRow`, `serializeDocumentDetail`, the `ApiDocumentRow` type if defined here and now unused, and the `DocumentStatus` import. Keep `serializeUsage`.

- [ ] **Step 2: Update the serializer test**

In `lib/api/serialize.test.ts`, delete the document-serializer describe blocks and the corresponding imports; keep `serializeUsage` coverage.

- [ ] **Step 3: Remove the document read/search functions from `lib/data.ts`**

Delete `interface DocumentListRow`, `documentConditions`, `searchDocuments`, `getDocumentDetail`, `getDocumentFilterOptions`, `interface ApiDocumentFilters`, `listDocumentsByCursor`. Leave the dashboard/analytics/health queries and everything else untouched.

- [ ] **Step 4: Delete `documents-search`**

```bash
git rm lib/documents-search.ts lib/documents-search.test.ts
```

- [ ] **Step 5: Verify no dangling references**

Run:
```bash
grep -rn "documents-search\|serializeDocumentRow\|serializeDocumentDetail\|ApiDocumentRow\|DocumentStatus\|DocumentListRow\|documentConditions\|searchDocuments\|getDocumentDetail\|getDocumentFilterOptions\|ApiDocumentFilters\|listDocumentsByCursor" app lib --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v worktrees
```
Expected: no results.

- [ ] **Step 6: Build + test**

Run: `npm run build && npm test`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove unused document read/serialize/search code"
```

---

### Task 7: Drop the removed tables + Phase-3 columns (schema + migration)

All code referencing these tables/columns is gone after Tasks 1–6, so they can be dropped. Keep `document` and `usageEvent` (billing).

**Files:**
- Modify: `lib/db/schema.ts` — remove table definitions `documentContact`, `marketingContact`, `lookupToken`, `webhookEndpoint`, `webhookDelivery`, and their entries in the exports block. Remove `tenantSettings` columns `supportEmail`, `supportUrl`, `returnWindowDays`, `warrantyPeriodMonths`. **KEEP** `document`, `usageEvent`, and the branding columns (`logoUrl`, `brandColor`, `brandBg`, `brandFg`, `brandMuted`).
- Create: a new migration under `drizzle/` via `npm run db:generate`.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Confirm the tables/columns are unreferenced in code**

Run:
```bash
grep -rn "documentContact\|marketingContact\|lookupToken\|webhookEndpoint\|webhookDelivery\|supportEmail\|supportUrl\|returnWindowDays\|warrantyPeriodMonths" app lib --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v worktrees | grep -v "lib/db/schema.ts"
```
Expected: no results (only `schema.ts` still mentions them, which this task removes). If anything else appears, STOP and remove that reference first.

- [ ] **Step 2: Remove the table definitions + column lines from `schema.ts`**

Delete the five `pgTable` blocks (`documentContact`, `marketingContact`, `lookupToken`, `webhookEndpoint`, `webhookDelivery`), their lines in the exports block, and the four `tenantSettings` column definitions. Also re-check `lib/db/relations.ts` — it has no references to these tables (verified), so it should need no change:
Run: `grep -n "documentContact\|marketingContact\|lookupToken\|webhookEndpoint\|webhookDelivery" lib/db/relations.ts`
Expected: no results.

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/NNNN_*.sql` file containing `DROP TABLE` for the five tables and `ALTER TABLE tenant_settings DROP COLUMN` for the four columns.

- [ ] **Step 4: Strip the generated SQL to only the intended changes**

Per the known drizzle-snapshot-drift gotcha, open the generated `.sql` and remove any spurious FK/constraint churn Drizzle emits for unrelated tables. The file should contain ONLY the five `DROP TABLE` statements and the four `DROP COLUMN` statements (plus their `--> statement-breakpoint` separators). Keep the paired `drizzle/meta/` snapshot update that `db:generate` produced.

- [ ] **Step 5: Build + test (schema typechecks; migration is not applied here)**

Run: `npm run build && npm test`
Expected: both PASS. (Do NOT run `db:migrate` — applying to Neon is a deploy step handled separately.)

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts drizzle
git commit -m "refactor(db): drop document-contact/marketing/lookup/webhook tables + phase-3 settings cols"
```

---

### Task 8: Final sweep + docs

Catch any leftover document/print copy and confirm the whole app is green.

**Files:**
- Modify: `app/(tenant)/tenant/api/page.tsx` — remove/repoint the copy that references `GET /documents` API endpoints (the endpoint is gone; describe the trigger endpoint instead or drop the line).
- Modify: `CLAUDE.md` — update the "Device → ingest → document flow" section to the trigger-only model (only if it still describes ingest as current).

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Find leftover document/ingest copy**

Run:
```bash
grep -rn "ingest\|/documents\|document" "app/(tenant)/tenant/api/page.tsx" CLAUDE.md README.md 2>/dev/null | grep -v node_modules
```
Update the tenant API docs page copy and the `CLAUDE.md` "Device → ingest → document flow" section to describe: caller `POST /api/v1/devices/{deviceId}/trigger` with the **unchanged** body `{ action:"show_qr", payload:{ url } }` → device shows a QR → ACK settles 1 credit. Do not rewrite unrelated docs.

- [ ] **Step 2: Full green check**

Run: `npm run build && npm test && npm run lint`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: describe trigger-only device flow; remove ingest/document references"
```

---

## Self-Review

**Spec coverage check (against `2026-07-02-trigger-only-device-design.md`):**
- §1 Trigger API + request body kept EXACTLY as-is → no task touches `trigger/route.ts` or `trigger-actions.ts` (frozen by Global Constraints). ✅
- §2 Remove ingest/R2-doc path → **Task 5**; v1 documents API → **Task 3**; public `/d` + `/d/lookup` → **Task 4**; `lib/documents.ts` region, `lib/documents-search`, `lib/lookup` → **Tasks 4 & 6**; Phase 3A–3C features → **Task 4**; webhook subsystem → **Task 1**; document UI + nav → **Tasks 2 & 4**; schema drops (documentContact/marketingContact/lookupToken/webhookEndpoint/webhookDelivery + tenantSettings cols) → **Task 7**; keep `document` + `usageEvent` vestigial → honored (never deleted). ✅
- §3 Billing untouched → no task touches `lib/billing*`, `invoice`, `perPrintPriceCents`, `getApiUsage`/`serializeUsage`. ✅
- §4 Kept-unchanged list (device claim/commands/config/firmware, credits, R2 core, branding, stores, audit, auth) → never targeted. ✅
- Metric repoint explicitly deferred to a follow-up plan → not in this plan by design. ✅

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N" — every code step shows the actual command or the exact symbols to remove. ✅

**Type consistency:** `claimDevice`/`getUnclaimedDevices`/`ClaimResult` (Task 4) and `serializeUsage` (Task 6) are preserved for their existing consumers; the trigger contract (`validateTriggerBody` → `{ action, payload }`) is frozen; the deletion-order rule ensures no symbol is removed while still imported. ✅

## Deferred / Follow-up

- **Metric repoint plan** — repoint dashboard/analytics/report/health count-and-series queries (`lib/data.ts`, `lib/types.ts`, `components/charts.tsx`, ~12 pages) from the vestigial `document` table to trigger counts (credit ledger `kind=settle`/`action=show_qr`; `deviceCommand` `type=trigger`). Until then, those surfaces show 0.
- **Billing pass** — retire the per-print metered-invoice model (`billing-engine.ts`, `invoice`, dunning cron, Phase 1C emails) and the vestigial `document`/`usageEvent` tables once credits are the sole model.
- **Firmware repo (`maratus-firmware`)** — strip the now-dead receipt-render/upload/print pipeline.
- **Apply migration** — run `npm run db:migrate` against Neon as part of deploy.

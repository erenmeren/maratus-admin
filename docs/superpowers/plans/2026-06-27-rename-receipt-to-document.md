# Rename Receipt → Document (Cloud, Spec 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename every "receipt" → "document" across the `maratus-admin` cloud — UI, code, DB, public API, webhooks, the QR route, and the Stripe meter — with no back-compat, ending with a green build/tests and zero "receipt" remaining.

**Architecture:** An atomic rename. Because renaming the schema export + identifiers breaks all consumers until every file is updated, the rename is done in ONE pass (Task 1: scripted bulk replace + targeted manual fixups + file/dir moves + hand-written migration), then applied to prod + deployed (Task 2). A rename cannot be split into independently-building slices.

**Tech Stack:** Next.js 16, Drizzle/Neon, Vitest. Bulk via `sed`; structural moves via `git mv`.

## Global Constraints

- **Term:** `Document`/`Documents`/`document` everywhere. Hard rename, **no aliases/redirects**: `/api/v1/receipts`, `/r/{token}`, `receipt.*` webhooks all cease to exist (404 / unknown).
- **Three replacements cover all case/compound variants** (substring replace handles `receiptId`, `receipt_id`, `receipt.created`, `ReceiptRow`, etc.): `receipt`→`document`, `Receipt`→`Document`, `RECEIPT`→`DOCUMENT`.
- **Bulk-rename scope:** `lib/ app/ components/` (`*.ts`/`*.tsx`) + `CLAUDE.md` + `AGENTS.md`. **Never touch:** `node_modules/`, `.next/`, `drizzle/` (migration SQL is hand-authored; meta is regenerated), historical `docs/superpowers/` specs/plans, `.git/`.
- **Migration is hand-written RENAMEs** (Postgres metadata-only, data-preserving) — NOT a drizzle DROP/CREATE.
- **`/r/`→`/d/` spots have NO "receipt" word** (sed misses them) — handle manually: the route dir, the ingest URL, and `lib/observability.ts` (+ its test).
- **Keep:** `tenantSettings.perPrintPriceCents`, the `/api/ingest` endpoint name.
- **Grep gate (done):** `grep -rinE "receipt" lib app components --include="*.ts" --include="*.tsx"` → 0.
- Build/test: `npm run build`, `npx tsc --noEmit`, `npm run test`. Branch `feat/rename-receipt-to-document`. Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **`.env.local` IS prod** — Task 2 mutates prod (table rename + deploy).

---

## Task 1: The rename (code + schema + migration authored)

**Files:** ~90 `.ts/.tsx` + ~12 path renames + `lib/db/schema.ts` + `lib/db/relations.ts` + new `drizzle/0023_*.sql` + `CLAUDE.md`/`AGENTS.md`.

**Interfaces produced:** `document` table/exports; `listDocumentsByCursor`, `serializeDocumentRow`, `DocumentRow`/`ApiDocumentRow`/`DocumentMetadata`, `documentToken`, `recordUsageEvent({documentId})`, `reportDocumentUsage`, `DocumentFilters`; `WEBHOOK_EVENT_TYPES=["document.created","document.downloaded"]`; routes `/api/v1/documents`, `/d/[token]`.

- [ ] **Step 1: `git mv` the receipt-named paths**

```bash
cd /Users/eren/Projects/maratus-admin
git mv lib/receipts.ts lib/documents.ts
git mv lib/receipts-search.ts lib/documents-search.ts
git mv lib/receipts-search.test.ts lib/documents-search.test.ts
git mv components/receipts components/documents
git mv components/documents/receipt-detail.tsx components/documents/document-detail.tsx
git mv components/documents/receipt-filters.tsx components/documents/document-filters.tsx
git mv components/documents/receipts-table.tsx components/documents/documents-table.tsx
git mv "app/(admin)/admin/receipts/[receiptId]" "app/(admin)/admin/receipts/[documentId]"
git mv "app/(admin)/admin/receipts" "app/(admin)/admin/documents"
git mv "app/(tenant)/tenant/receipts/[receiptId]" "app/(tenant)/tenant/receipts/[documentId]"
git mv "app/(tenant)/tenant/receipts" "app/(tenant)/tenant/documents"
git mv "app/api/v1/receipts" "app/api/v1/documents"
git mv "app/(public)/r" "app/(public)/d"
```
(If a parent must move before its child errors, do the child-dir rename first as shown.) Verify with `git status` that all are renames.

- [ ] **Step 2: Bulk content replace (case-sensitive, scoped)**

Run the three substitutions over the scoped files (this also renames the table/index NAME strings inside `schema.ts` and the import paths to the moved files):
```bash
FILES=$(grep -rilE "receipt" lib app components CLAUDE.md AGENTS.md --include="*.ts" --include="*.tsx" 2>/dev/null; echo CLAUDE.md AGENTS.md)
FILES=$(printf '%s\n' $FILES | sort -u)
for f in $FILES; do
  [ -f "$f" ] || continue
  LC_ALL=C sed -i '' -e 's/receipt/document/g' -e 's/Receipt/Document/g' -e 's/RECEIPT/DOCUMENT/g' "$f"
done
```
(Use `grep -rilE` to also pick up `.md`. The `app/(public)/d/[token]` page's copy "Your receipt…" → "Your document…" is handled here.)

- [ ] **Step 3: Fix the `/r/` → `/d/` spots sed missed (no "receipt" word)**

- `lib/observability.ts`: change the scrubber regex `/\/r\/[^/?#]+/g` → `/\/d\/[^/?#]+/g` and the replacement `"/d/[redacted]"`; update the comments ("`/r/<token>`" → "`/d/<token>`"). (The "receipt token" wording already became "document token" via sed.)
- `lib/observability.test.ts`: update the `/r/...` fixtures + expectations to `/d/...` (the two scrub tests).
- **Ingest URL:** find where the public URL is built (`grep -rn "/r/" app lib --include="*.ts"` after Step 2; the ingest route returns `{BETTER_AUTH_URL}/r/{token}`) and change `/r/` → `/d/`. Confirm `app/api/ingest/route.ts` returns `…/d/${token}`.
- Leave incidental made-up URLs in unrelated tests (e.g. `trigger-actions.test.ts` `https://x.co/r/abc` is a generic fixture, not the document route) — but the grep gate in Step 7 will flag only "receipt", not "/r/", so these are fine.

- [ ] **Step 4: Author the migration (hand-written RENAMEs)**

After Step 2 edited `lib/db/schema.ts`, regenerate to refresh the drizzle meta snapshot, then REPLACE the generated SQL body with renames:
```bash
npm run db:generate
```
Open the new `drizzle/0023_*.sql` and replace its contents (the generator will produce DROP/CREATE — discard that) with:
```sql
ALTER TABLE "receipt" RENAME TO "document";--> statement-breakpoint
ALTER TABLE "document" RENAME CONSTRAINT "receipt_organization_id_organization_id_fk" TO "document_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "document" RENAME CONSTRAINT "receipt_device_id_device_id_fk" TO "document_device_id_device_id_fk";--> statement-breakpoint
ALTER TABLE "document" RENAME CONSTRAINT "receipt_store_id_store_id_fk" TO "document_store_id_store_id_fk";--> statement-breakpoint
ALTER INDEX "receipt_token_idx" RENAME TO "document_token_idx";--> statement-breakpoint
ALTER INDEX "receipt_organization_id_idx" RENAME TO "document_organization_id_idx";--> statement-breakpoint
ALTER INDEX "receipt_device_id_idx" RENAME TO "document_device_id_idx";--> statement-breakpoint
ALTER INDEX "receipt_store_id_idx" RENAME TO "document_store_id_idx";--> statement-breakpoint
ALTER INDEX "receipt_created_at_idx" RENAME TO "document_created_at_idx";--> statement-breakpoint
ALTER TABLE "usage_event" RENAME COLUMN "receipt_id" TO "document_id";--> statement-breakpoint
ALTER INDEX "usage_event_receipt_id_idx" RENAME TO "usage_event_document_id_idx";--> statement-breakpoint
ALTER TABLE "usage_event" RENAME CONSTRAINT "usage_event_receipt_id_receipt_id_fk" TO "usage_event_document_id_document_id_fk";--> statement-breakpoint
ALTER TABLE "invoice" RENAME COLUMN "receipt_count" TO "document_count";
```
**IMPORTANT:** verify the EXACT current constraint/index names first — run `psql`-style introspection via a throwaway probe OR check the existing `0000_init.sql` + later migrations for the real FK/constraint names, and match them exactly (names differ if Drizzle auto-generated them differently). If a `RENAME CONSTRAINT` name is wrong the migration errors — adjust to the real names. (The meta snapshot from `db:generate` already reflects "document"; keep it.) Do NOT apply yet — Task 2 applies it.

- [ ] **Step 5: Build + type-check, fix fallout**

```bash
npx tsc --noEmit
npm run build
```
Fix any compile errors from the rename (usually a missed import or a string the bulk pass didn't reach). Re-run until clean.

- [ ] **Step 6: Tests green**

```bash
npm run test
```
Update/confirm test expectations changed by the rename (webhook-events expects `document.*`; billing meter test expects `"documents"`; documents-search test; serialize; openapi). All 254 pass.

- [ ] **Step 7: Grep gate**

```bash
grep -rinE "receipt" lib app components --include="*.ts" --include="*.tsx"
```
Expected: **no output**. Investigate any remaining hit (it's either a missed rename or — only acceptable — an incidental non-document URL like the trigger test fixture; if it's the latter leave it and note it, otherwise rename it). Also `grep -rn "/r/" app lib --include="*.ts" --include="*.tsx"` should show only non-document URLs (no token route).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rename Receipt -> Document across cloud (DB, API, webhooks, UI)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Apply to prod + deploy + live smoke

**Files:** none (ops). `.env.local` IS prod — the migration renames the prod table; deploy must follow immediately.

- [ ] **Step 1: Apply the migration to prod**

```bash
npm run db:migrate
```
Expected: `0023` applies cleanly (RENAMEs are instant). If it errors on a constraint/index name, fix the SQL (Task 1 Step 4) to the real name and re-run.

- [ ] **Step 2: Deploy immediately**

```bash
vercel --prod --yes
```
(Run right after the migration so prod code and the renamed table are consistent.)

- [ ] **Step 3: Live smoke**

- `curl -s -o /dev/null -w "%{http_code}" https://ditto-admin-brown.vercel.app/api/v1/documents -H "Authorization: Bearer <scoped key>"` → 200 (and `/api/v1/receipts` → 404).
- Open a known document's public page `https://ditto-admin-brown.vercel.app/d/{token}` → renders (and a first view flips `ready→downloaded`); `/r/{token}` → 404.
- Authed: admin `/admin/documents` + tenant `/tenant/documents` render; nav says "Documents".
- `GET /api/v1/openapi.json` → paths show `/documents`, no `/receipts`.
- (Optional) confirm a fresh ingest returns a `…/d/{token}` url.

- [ ] **Step 4: Stripe meter (ops reminder)**

The code now sends meter `event_name="documents"`. Remind the user to update the Stripe dashboard meter's `event_name` to `documents` (else metering stops). No code action.

- [ ] **Step 5: Record outcome** in the ledger + project memory (rename shipped; firmware = Spec 2 still pending; Stripe meter reconfig outstanding).

---

## Self-Review notes

- **Spec coverage:** DB rename + migration (T1 S1/S4, T2); code identifiers + file moves (T1 S1/S2); `/r/`→`/d/` incl observability + ingest URL (T1 S3); public API + openapi + public page (T1 S2 + moves); webhooks (T1 S2); Stripe meter default (T1 S2); UI/email/printer-screen text + CLAUDE/AGENTS (T1 S2); grep gate (T1 S7); deploy ordering + smoke (T2).
- **Atomicity rationale:** the rename can't build in partial states, so it's one task; the diff is large but mechanical — the task review focuses on the contract surfaces (API JSON fields, openapi, webhook event strings, the migration SQL names, the `/d/` URL) and the grep gate.
- **Risk to watch:** the migration's `RENAME CONSTRAINT` names must match the DB's actual names (verify against `drizzle/0000_init.sql` + later migrations); a wrong name fails the migration (caught in T2 S1, fixable).

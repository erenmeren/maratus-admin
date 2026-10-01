# Maratus Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the cloud/admin product from **Maratus** to **Maratus** in all user-visible surfaces (UI, emails, docs, manuals, metadata) and produce the operator runbook for the domain cutover to `maratus.co`.

**Architecture:** Pure copy/identifier rename — no behavior change, no schema change, no migration. The brand lives in a handful of seams: `components/brand.tsx` (wordmark), auth/email templates, page copy, seed data, repo metadata, and Turkish manuals. Infra cutover (DNS, Vercel domain, `BETTER_AUTH_URL`, Resend) is operator work captured as a runbook, not code.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict; vitest (`npm test` = `vitest run`); tsc gate `npx tsc --noEmit`.

**Spec:** `docs/naming-candidates.md` — the "✅ KARAR VERİLDİ — MARATUS (2026-08-24)" block at the top (decision, bought domains `maratus.co` + `maratus.dev`, scope list).

## Global Constraints

- Brand casing: **"Maratus"** in prose/UI copy; **"maratus"** in slugs/filenames (e.g. `maratus-billing.csv`).
- Primary domain: **`https://maratus.co`** (apex). `maratus.dev` is reserved for future developer docs — no content in this plan.
- **DO NOT TOUCH (deliberate keeps — leaving "maratus" here is correct, not an oversight):**
  - `docs/superpowers/specs/**` and `docs/superpowers/plans/**` older than this plan, `docs/business/**`, `docs/naming-candidates.md`, `docs/runbooks/*` written before this plan — historical record (same precedent as the kiosk→printer rename).
  - `lib/db/migrations/**` and all DB identifiers/values; alert key `documents-stuck` precedent applies.
  - R2 bucket name `ditto-receipts` (`.env.example` `R2_BUCKET`) — R2 buckets can't be renamed; invisible to users.
  - Firmware storage key `firmware/<v>/maratus-firmware.bin` (`lib/storage.ts:101`, `lib/firmware.test.ts`) — must keep matching what the firmware build produces until the firmware repo's own rename.
  - `CONFIG_DITTO_FW_VERSION` mentions (`app/(admin)/admin/firmware/page.tsx`, `lib/actions/firmware.ts`) — real Kconfig symbol in the firmware repo; renames with the firmware plan, not this one.
  - References to the **repo name** `maratus-firmware` in comments (`lib/qr-svg.ts`, `app/api/mqtt/heartbeat/route.ts`, `lib/db/publish-firmware.ts`, `components/ui` parity notes) — the repo really is still called that.
  - `"https://*.vercel.app"` in `lib/auth.ts` trustedOrigins and the existing Vercel project name / `*.vercel.app` URLs — the device fleet bootstraps against the old URL; it must keep working indefinitely (see Task 7 runbook).
  - `package-lock.json` — only changes via `npm install` in Task 5, never by hand.
- Gates after every task: `npx tsc --noEmit` (0 errors) and `npm test` (all green). Working tree stays committed per task.
- This plan does NOT deploy. Deployment/cutover is the operator runbook (Task 7); user tests locally and batches deploys (established preference).

---

### Task 1: Brand component + shell identity

**Files:**
- Modify: `components/brand.tsx`
- Modify: `components/workspace-switcher.tsx`
- Modify: `app/(auth)/login/page.tsx` (import/usage only — copy is Task 2, demo hint is Task 4)
- Modify: `app/(auth)/signup/signup-form.tsx` (import/usage only)
- Modify: `app/(auth)/verify-email/verify-email-notice.tsx`
- Modify: `app/not-found.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `MaratusMark({ className }?)` and `MaratusWordmark(...)` exported from `components/brand.tsx` — same props/signatures as today's `MaratusMark` / `MaratusWordmark`, only renamed. Later tasks and all five importer files use these names.

- [ ] **Step 1: Rename the brand components and wordmark text**

In `components/brand.tsx`:
- Header comment `* Maratus wordmark. The mark is a pair of overlapping rounded squares — the device` → `* Maratus wordmark. The mark is a pair of overlapping rounded squares — the device`
- `export function MaratusMark(` → `export function MaratusMark(`
- `export function MaratusWordmark(` → `export function MaratusWordmark(`
- Internal usage `<MaratusMark />` → `<MaratusMark />`
- Wordmark text `<span className="font-display text-lg font-bold tracking-tight">Maratus</span>` → `...>Maratus</span>`

The SVG mark itself (overlapping rounded squares, brand green) stays as-is — a Maratus logo redesign is deliberately out of scope.

- [ ] **Step 2: Update the five importers**

Mechanical in each file: `import { MaratusWordmark } from "@/components/brand"` → `MaratusWordmark` (and `MaratusMark` → `MaratusMark` in `components/workspace-switcher.tsx`), plus every JSX usage. Files: `app/(auth)/login/page.tsx:12,58`, `app/(auth)/signup/signup-form.tsx:11,46`, `app/(auth)/verify-email/verify-email-notice.tsx:8,31`, `app/not-found.tsx:3,9`, `components/workspace-switcher.tsx:19,64`.

- [ ] **Step 3: Rename the HQ workspace label (same file as Step 2)**

In `components/workspace-switcher.tsx`:
- `const headerName = active === "admin" ? "Maratus HQ" : activeName;` → `"Maratus HQ"`
- `<span className="text-sm font-medium">Maratus HQ</span>` → `Maratus HQ`

And in `app/(admin)/layout.tsx`:
- `topBarLabel="Super Admin · Maratus HQ"` → `topBarLabel="Super Admin · Maratus HQ"`
- `activeName="Maratus HQ"` → `activeName="Maratus HQ"`

- [ ] **Step 4: Page metadata + CSS comment**

`app/layout.tsx`: `title: "Maratus — Admin Console"` → `"Maratus — Admin Console"`; description `"Maratus admin console: manage screens, stores, and triggered content."` → `"Maratus admin console: manage screens, stores, and triggered content."`
`app/globals.css`: comment `Maratus brand tokens.` → `Maratus brand tokens.`

- [ ] **Step 5: Verify**

Run: `grep -rn "MaratusMark\|MaratusWordmark" app components lib` → expected: no output.
Run: `npx tsc --noEmit` → 0 errors. Run: `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add components/brand.tsx components/workspace-switcher.tsx app/(auth) app/not-found.tsx app/layout.tsx app/(admin)/layout.tsx app/globals.css
git commit -m "feat(rename): Maratus brand component, wordmark and shell identity"
```

---

### Task 2: User-visible copy sweep (pages, dialogs, previews, API message)

**Files:**
- Modify: `app/page.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/signup/signup-form.tsx`, `app/archived/page.tsx`
- Modify: `app/(admin)/admin/page.tsx`, `app/(admin)/admin/customers/page.tsx`, `app/(admin)/admin/billing/page.tsx`
- Modify: `app/(tenant)/tenant/api/page.tsx`
- Modify: `components/new-customer-dialog.tsx`, `components/delete-store-dialog.tsx`, `components/claim-device-dialog.tsx`
- Modify: `components/device-preview/printer-preview.tsx`, `components/branding-studio/branding-studio.tsx`
- Modify: `app/api/v1/devices/[deviceId]/trigger/route.ts`

**Interfaces:** none — string literals only.

- [ ] **Step 1: Apply the exact replacements**

| File:line | Old | New |
|---|---|---|
| `app/page.tsx:20` | `Trigger a Maratus screen from your own systems` | `Trigger a Maratus screen from your own systems` |
| `app/(auth)/login/page.tsx:182` | `New to Maratus?` | `New to Maratus?` |
| `app/(auth)/login/page.tsx:194` | `© 2026 Maratus · Any content, one scan away.` | `© 2026 Maratus · Any content, one scan away.` |
| `app/(auth)/login/page.tsx:215` | `Trigger a Maratus screen from your systems` | `Trigger a Maratus screen from your systems` |
| `app/(auth)/signup/signup-form.tsx:34` | `toast.success("Welcome to Maratus", {` | `toast.success("Welcome to Maratus", {` |
| `app/(auth)/signup/signup-form.tsx:133` | `© 2026 Maratus · Any content, one scan away.` | `© 2026 Maratus · Any content, one scan away.` |
| `app/archived/page.tsx:18` | `contact your Maratus account manager.` | `contact your Maratus account manager.` |
| `app/(admin)/admin/page.tsx:36` | `Platform-wide performance across all Maratus customers.` | `...all Maratus customers.` |
| `app/(admin)/admin/customers/page.tsx:71` | `store chains on Maratus` | `store chains on Maratus` |
| `app/(admin)/admin/billing/page.tsx:62` | `filename="maratus-billing.csv"` | `filename="maratus-billing.csv"` |
| `app/(tenant)/tenant/api/page.tsx:23` | `Read-only keys for the Maratus public API.` | `Read-only keys for the Maratus public API.` |
| `components/new-customer-dialog.tsx:40` | `` `${name} has been added to Maratus.` `` | `` `${name} has been added to Maratus.` `` |
| `components/new-customer-dialog.tsx:58` | `Add a store chain to the Maratus platform.` | `Add a store chain to the Maratus platform.` |
| `components/delete-store-dialog.tsx:57` | `zero-touch setup will need to be re-armed by Maratus.` | `...re-armed by Maratus.` |
| `components/claim-device-dialog.tsx:164` | `security, Maratus only keeps a hashed copy.` | `security, Maratus only keeps a hashed copy.` |
| `components/device-preview/printer-preview.tsx:276` | `const PREVIEW_QR_VALUE = "https://maratus.app";` | `const PREVIEW_QR_VALUE = "https://maratus.co";` |
| `components/branding-studio/branding-studio.tsx:540` | `const QR_STYLE_PREVIEW_VALUE = "https://maratus.app";` | `const QR_STYLE_PREVIEW_VALUE = "https://maratus.co";` |
| `app/api/v1/devices/[deviceId]/trigger/route.ts:57` | `Contact Maratus to activate it.` | `Contact Maratus to activate it.` |

Do NOT touch `app/(admin)/admin/firmware/page.tsx` (`CONFIG_DITTO_FW_VERSION` is a real firmware symbol — Global Constraints).

- [ ] **Step 2: Verify**

Run: `grep -rn "Maratus" app components --include="*.tsx" | grep -v "CONFIG_DITTO_FW_VERSION"` → expected: no output.
Run: `npx tsc --noEmit` and `npm test` → green.

- [ ] **Step 3: Commit**

```bash
git add app components
git commit -m "feat(rename): Maratus copy sweep across pages, dialogs and previews"
```

---

### Task 3: Auth + transactional emails (tests first)

**Files:**
- Test (modify first): `lib/integration-status.test.ts`, `lib/devices/device-emails.test.ts`, `lib/billing/invoice-emails.test.ts`, `lib/observability.test.ts`
- Modify: `lib/auth.ts`, `lib/actions/customers.ts`, `lib/billing/invoice-emails.ts`, `lib/devices/device-emails.ts`, `lib/alerts.ts`, `lib/env.ts`, `lib/integration-status.ts`

**Interfaces:** none exported change — string constants only (`BRAND`, email subjects, `appName`).

- [ ] **Step 1: Flip the test expectations (RED)**

- `lib/integration-status.test.ts`: every `maratus.app` → `maratus.co`; every `Maratus <` → `Maratus <` (lines 6, 9, 18, 21, 28, 43, 44, 50, 55; line 9's case-test `NoReply@Maratus.App` → `NoReply@Maratus.Co` with expectation `"maratus.co"`). Keep `onboarding@resend.dev` addresses as-is but display name `Maratus` → `Maratus`.
- `lib/devices/device-emails.test.ts`: `"A Maratus printer went offline"` → `"A Maratus printer went offline"`; `"2 Maratus printers went offline"` → `"2 Maratus printers went offline"`.
- `lib/billing/invoice-emails.test.ts`: test name `"wraps the body with the Maratus wordmark"` → `"...Maratus wordmark"`; `expect(html).toContain("Maratus")` → `toContain("Maratus")`.
- `lib/observability.test.ts`: fixture URL `https://app.maratus/tenant/stores/str_1?x=1` → `https://app.maratus.co/tenant/stores/str_1?x=1` (both occurrences).

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test` → expected: the three brand-string suites FAIL (subject/domain mismatches). Anything else failing = stop and investigate.

- [ ] **Step 3: Implementation replacements (GREEN)**

| File:line | Old | New |
|---|---|---|
| `lib/auth.ts:20` | `appName: "Maratus",` | `appName: "Maratus",` |
| `lib/auth.ts:4` (comment) | `lets Maratus staff` | `lets Maratus staff` |
| `lib/auth.ts:49` | `"Verify your Maratus account",` | `"Verify your Maratus account",` |
| `lib/auth.ts:50` | `<p>Welcome to Maratus. Confirm your email...` | `<p>Welcome to Maratus. Confirm your email...` |
| `lib/auth.ts:57` (comment) | `(Maratus staff)` | `(Maratus staff)` |
| `lib/auth.ts:72` | `` `You're invited to ${data.organization.name} on Maratus` `` | `...on Maratus` `` |
| `lib/auth.ts:74` | `on Maratus.</p>` | `on Maratus.</p>` |
| `lib/actions/customers.ts:137` | `` `You're invited to own ${org.name} on Maratus` `` | `...on Maratus` `` |
| `lib/actions/customers.ts:138-139` | `The Maratus team invited you to own` / `on Maratus.</p>` | `The Maratus team invited you to own` / `on Maratus.</p>` |
| `lib/billing/invoice-emails.ts:14` | `const BRAND = "Maratus";` | `const BRAND = "Maratus";` |
| `lib/devices/device-emails.ts:11` | `"A Maratus printer went offline" : ... ${n} Maratus printers went offline` | `"A Maratus printer went offline" : ... ${n} Maratus printers went offline` |
| `lib/alerts.ts:60` | `` `⚠ Maratus: ${newAlerts.length} new health alert...` `` | `` `⚠ Maratus: ...` `` |
| `lib/env.ts:27-29` | comment `Set to "Maratus <noreply@yourdomain.com>"...` and `EMAIL_FROM: z.string().default("Maratus <onboarding@resend.dev>"),` | `"Maratus <noreply@maratus.co>"` in the comment; default `"Maratus <onboarding@resend.dev>"` |
| `lib/integration-status.ts:25` | `` /** `Maratus <noreply@maratus.app>` → `maratus.app`... */ `` | `` /** `Maratus <noreply@maratus.co>` → `maratus.co`... */ `` |

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test` → all green. Run: `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add lib
git commit -m "feat(rename): Maratus in auth, transactional emails and alert copy"
```

---

### Task 4: Seed data + login demo hint

**Files:**
- Modify: `lib/db/seed.ts`
- Modify: `app/(auth)/login/page.tsx`

**Interfaces:** none. Note: this changes what a **re-seeded dev DB** contains. The production platform-admin user keeps its existing email — changing prod data is an optional operator step in the Task 7 runbook, never automatic.

- [ ] **Step 1: Seed replacements**

In `lib/db/seed.ts`: comment `1 platform_admin user (Maratus staff)` → `(Maratus staff)`; `name: "Maratus Staff",` → `name: "Maratus Staff",`; `email: "admin@maratus.app",` → `email: "admin@maratus.co",`; `console.log("Seeding Maratus…");` → `console.log("Seeding Maratus…");`. Password and all other seed data (dana@roastwell.co etc.) unchanged.

- [ ] **Step 2: Login demo hint**

In `app/(auth)/login/page.tsx`: `setEmail("admin@maratus.app");` → `setEmail("admin@maratus.co");` and the visible label `admin@maratus.app` → `admin@maratus.co`. First confirm this demo-credentials block matches the seed (it exists to quick-fill seed accounts); if it renders in production too, flag it in the Task 7 runbook note about the prod admin email.

- [ ] **Step 3: Verify**

Run: `grep -rin "maratus" lib/db/seed.ts app/(auth)` → expected: no output.
Run: `npx tsc --noEmit` and `npm test` → green. (Do not run `db:seed` — `.env.local` points at PROD.)

- [ ] **Step 4: Commit**

```bash
git add lib/db/seed.ts app/(auth)/login/page.tsx
git commit -m "feat(rename): Maratus seed identities and login demo hint"
```

---

### Task 5: Repo metadata — package, OpenAPI, README, CLAUDE.md, DEVELOPMENT, .env.example

**Files:**
- Modify: `package.json` (+ `package-lock.json` via `npm install`)
- Modify: `openapi.json`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `.env.example`
- Modify: `lib/types.ts`, `lib/db/schema.ts` (header comments)

**Interfaces:** none.

- [ ] **Step 1: Package + OpenAPI**

`package.json`: `"name": "maratus-admin"` → `"name": "maratus-admin"`. Then run `npm install` so the lockfile's root name syncs (only diff should be the name field).
`openapi.json`: `"title": "Maratus Public API"` → `"Maratus Public API"`; in the description, `created in the Maratus dashboard` → `created in the Maratus dashboard`.

- [ ] **Step 2: README.md brand sweep + stale-billing fix**

Replace every prose `Maratus` → `Maratus` (title `# Maratus` → `# Maratus`, ~14 occurrences). One content fix while there: the pricing paragraph still says `Maratus uses prepaid credits. Each interaction successfully shown to a customer...` — replace that paragraph with the current model in two sentences: `Maratus is sold as a subscription: each device slot is $15/month billed annually by bank transfer, and every paid slot includes 1,000 triggers/month pooled across the organization. Usage beyond the pool is billed post-paid at $0.02/trigger on the next invoice — overage never blocks a request.`

- [ ] **Step 3: CLAUDE.md + DEVELOPMENT.md + .env.example**

`CLAUDE.md`: `# Maratus Admin` → `# Maratus Admin`; `admin console for **Maratus**` → `admin console for **Maratus**`; `Maratus hosts nothing` → `Maratus hosts nothing`; `Maratus no longer ingests or hosts documents` → `Maratus no longer ingests...`; seed line `**admin@maratus.app**` → `**admin@maratus.co**`.
`docs/DEVELOPMENT.md`: replace its 7 `Maratus` occurrences with `Maratus` (read the file; they are prose/branding — if any refers to the literal repo directory `maratus-admin` or `maratus-firmware`, keep those path references as-is).
`.env.example`: `Set to "Maratus <noreply@yourdomain.com>" after` → `Set to "Maratus <noreply@maratus.co>" after`; `EMAIL_FROM="Maratus <onboarding@resend.dev>"` → `EMAIL_FROM="Maratus <onboarding@resend.dev>"`. **Keep** `R2_BUCKET="ditto-receipts"` (Global Constraints).
Header comments: `lib/db/schema.ts:1` `// Drizzle schema for Maratus.` → `for Maratus.` and `:38` `Maratus staff = 'platform_admin'` → `Maratus staff...`; `lib/types.ts:1` `// Core domain types for the Maratus admin app.` → `...the Maratus admin app.`

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`, `npm test`, and `npm run build` (metadata rename must not break the build).
Run: `git diff package-lock.json | head -20` → only the name field changed.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json openapi.json README.md CLAUDE.md docs/DEVELOPMENT.md .env.example lib/db/schema.ts lib/types.ts
git commit -m "feat(rename): maratus-admin package, OpenAPI title and repo docs"
```

---

### Task 6: Turkish user manuals

**Files:**
- Modify: `docs/manuals/tr/super-admin-kilavuzu.md` (~38 occurrences)
- Modify: `docs/manuals/tr/kiraci-kilavuzu.md` (~32 occurrences)

**Interfaces:** none. ⚠️ NOT mechanical — Turkish apostrophe suffixes follow vowel harmony and change with the new name.

- [ ] **Step 1: Replace with suffix awareness**

Base replace `Maratus` → `Maratus`, then fix every apostrophe suffix to match Maratus (back-vowel, ends in consonant `s`). Mapping:

| Maratus form | Maratus form |
|---|---|
| `Maratus'ya` | `Maratus'a` |
| `Maratus'yu` | `Maratus'u` |
| `Maratus'nun` | `Maratus'un` |
| `Maratus'da` | `Maratus'ta` |
| `Maratus'dan` | `Maratus'tan` |
| `Maratus'yla` | `Maratus'la` |

After the sweep, grep each file for `Maratus'` and read every hit in context to confirm the suffix is grammatical. There are no absolute URLs in these manuals (verified) — nothing to repoint.

- [ ] **Step 2: Verify + commit**

Run: `grep -rin "maratus" docs/manuals/` → expected: no output.

```bash
git add docs/manuals/tr
git commit -m "docs(rename): Maratus in Turkish user manuals"
```

PDF regeneration (make-pdf) is deferred to when the manuals next ship — note it in the Task 7 runbook's follow-up list.

---

### Task 7: Cutover runbook + residual audit

**Files:**
- Create: `docs/runbooks/maratus-cutover.md`

**Interfaces:** none — operator document. The code tasks above are safe to deploy at any time (they don't depend on DNS); this runbook is what makes `maratus.co` live.

- [ ] **Step 1: Write `docs/runbooks/maratus-cutover.md` with exactly this content**

```markdown
# Maratus Cutover Runbook (rename: Maratus → Maratus)

Code rename plan: docs/superpowers/plans/2026-08-24-maratus-rename.md
Decision record: docs/naming-candidates.md (top block)
Domains owned: maratus.co (primary), maratus.dev (future developer docs — park for now)

## Order of operations

1. **Deploy the rename commits** (Tasks 1–6) to Vercel prod — safe before DNS;
   everything keeps working on the existing *.vercel.app URL.
2. **DNS + Vercel domain**
   - Vercel dashboard → project `maratus-admin` (internal name stays!) → Domains →
     add `maratus.co` and `www.maratus.co` (www → apex redirect).
   - At the registrar, point maratus.co per Vercel's instructions
     (A 76.76.21.21 or the CNAME it shows). Wait for the domain to show Valid.
3. **Auth origin**: Vercel env (Production) `BETTER_AUTH_URL=https://maratus.co`,
   then redeploy. `lib/auth.ts` trustedOrigins picks it up via env; `*.vercel.app`
   stays trusted — do NOT remove it.
4. **Local env**: update `.env.local` `BETTER_AUTH_URL` the same way
   (⚠️ .env.local points at PROD — touch only this var).
5. **Resend (closes the standing e-mail blocker)**
   - Resend dashboard → Domains → add `maratus.co`; create the DKIM/SPF DNS
     records at the registrar; wait for Verified.
   - Vercel env: `EMAIL_FROM=Maratus <noreply@maratus.co>`; redeploy.
   - /admin integration status should now show e-mail domain verified;
     customer-facing mail (invoices, offline alerts, invites) starts flowing.
6. **Verify**: log in at https://maratus.co; run one end-to-end trigger against a
   test device; check invite e-mail renders "Maratus" and arrives from
   noreply@maratus.co.

## Do NOT do

- Do NOT rename the Vercel project or delete/detach the old *.vercel.app domains:
  the device fleet's firmware has the old base URL baked in for the two HTTPS
  bootstrap routes (GET /api/device/claim, GET /api/device/identity). The old URL
  must keep serving until the firmware fleet is migrated and converged.
- Do NOT rename the R2 bucket (`ditto-receipts`) — R2 has no rename; nothing
  user-visible leaks it.
- Do NOT run db:seed against prod.

## Optional / follow-ups

- Prod platform-admin login is still the old seed e-mail (admin@maratus.app).
  Either keep it, or update the user row's e-mail to admin@maratus.co manually
  (Drizzle Studio) — the login page demo hint now shows admin@maratus.co.
- GitHub/local repo directory renames (maratus-admin → maratus-admin,
  maratus-firmware → maratus-firmware): defer; breaks local paths, Vercel link
  and memory-dir naming. Do both in one sitting later if desired.
- Turkish manual PDFs: regenerate via make-pdf next time manuals ship.
- maratus.dev: park or redirect to maratus.co until a docs site exists.

## Firmware follow-up (separate plan, maratus-firmware repo)

User-visible "Maratus" strings live in firmware too ("Contacting Maratus..." boot
stage, Kconfig menu names) and the prod build's base URL points at the old
domain. Plan separately: restring UI copy → point MARATUS_API_BASE_URL at
https://maratus.co → ship as an OTA release → only after the fleet converges
may the old URL ever be retired (in practice: never retire it; it costs nothing).
```

- [ ] **Step 2: Residual audit**

Run: `grep -rli "maratus" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git . | grep -v "^./docs/superpowers/" | grep -v "^./docs/business/" | grep -v "^./docs/naming-candidates.md" | grep -v "^./docs/manuals"`

Expected remaining files, each covered by Global Constraints — anything NOT on this list is a missed rename, go fix it:
`.env.example` (R2 bucket), `package-lock.json` (dep hashes only — verify with `grep -i maratus package-lock.json`), `lib/storage.ts` + `lib/firmware.test.ts` (firmware binary key), `lib/db/publish-firmware.ts` (firmware repo path comment), `lib/qr-svg.ts` + `app/api/mqtt/heartbeat/route.ts` (maratus-firmware repo references), `app/(admin)/admin/firmware/page.tsx` + `lib/actions/firmware.ts` (CONFIG_DITTO_FW_VERSION), `docs/runbooks/*` (historical), `docs/device-protocol.md` (check: if its "Maratus" is prose branding rather than protocol constants, rename it here; protocol constants stay), `docs/DEVELOPMENT.md` should NOT appear (renamed in Task 5), `docs/runbooks/maratus-cutover.md` (mentions old name by design).

- [ ] **Step 3: Final gates + commit**

Run: `npx tsc --noEmit`, `npm test`, `npm run build` → all green.

```bash
git add docs/runbooks/maratus-cutover.md
git commit -m "docs(rename): Maratus cutover runbook"
```

---

## Out of scope (tracked, not forgotten)

- **Firmware repo rename + restring + base-URL OTA** — separate plan in `maratus-firmware` (see runbook's firmware section). Blocked on maratus.co being live and stable.
- **Logo redesign** (peacock-spider mark) — current overlapping-squares mark and brand green stay.
- **maratus.dev developer-docs site** — future work; openapi.json is the seed for it.
- **Trademark clearance** (TÜRKPATENT/EUIPO/USPTO class 9 + 42) — operator to-do, independent of code.
- **Repo/directory renames** — deferred (runbook "Optional").

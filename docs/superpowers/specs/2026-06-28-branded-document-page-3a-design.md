# Phase 3A — Branded Customer Document Page — Design

**Date:** 2026-06-28
**Repo:** `maratus-admin`
**Status:** Approved design, pre-implementation
**Phase:** 3 ("long-term vision"), sub-project **3A** (first). The realistic v1 of "customer-facing document features."

## Problem

The public `/d/{token}` page — what a customer sees after scanning the QR — is an anonymous bare image view: a hard-coded **Maratus** wordmark, no tenant branding, no store info, no contact affordance. The branding (brand color, logo) and store data already exist in the system; they're just not wired to the public route. 3A turns the page into a **branded, trustworthy customer experience**.

(Phase 3's grander visions — warranty/return lookup keyed on order#/amount, white-label domains, multi-region R2 — are blocked on missing structured business data / new infra and are out of scope; see the Phase 3 assessment.)

## Decisions (locked via brainstorming)

1. **Tenant logo leads; Maratus becomes a small "Powered by Maratus" footer.** Show the tenant's logo (presigned) in the header when set, else the org name as a wordmark.
2. **Brand color is an accent, not a full theme** — applied (inline, from the hex) to the "ready" check icon and the Download button only.
3. **Add two optional tenant fields** — `supportEmail` + `supportUrl` (return-policy/help link) — surfaced as a "Questions about this? Contact {store}" block; hidden when both blank.
4. **Provenance line:** "Issued by {org} · {store}", store address, date.
5. **No owner-email exposure** (privacy); contact uses only the explicit support fields.
6. **Migration discipline:** `db:generate` on this repo emits spurious FK churn (drift from the old rename) — the migration SQL must be stripped to ONLY the two `ADD COLUMN` statements. (See the `drizzle-snapshot-drift` lesson.)

## Architecture

### A) Data model — two optional `tenantSettings` columns (`lib/db/schema.ts` + migration)

Add to the `tenantSettings` table:
```ts
supportEmail: text("support_email"),   // nullable
supportUrl: text("support_url"),       // nullable
```
Generate the migration with `npm run db:generate`, then **hand-strip** it to only `ALTER TABLE "tenant_settings" ADD COLUMN "support_email" text;` + `ADD COLUMN "support_url" text;` (delete any FK DROP/ADD churn). Do NOT run `db:migrate` (prod step, deferred).

### B) Pure support-links helper — `lib/branding/support.ts` (new, IO-free)

```ts
export interface SupportLinks {
  email: string | null;   // a valid-looking email, else null
  url: string | null;     // an http(s) URL, else null
  show: boolean;          // email != null || url != null
}
export function supportLinks(input: { supportEmail: string | null; supportUrl: string | null }): SupportLinks;
export function isLikelyEmail(s: string): boolean;   // basic shape: has "@" and a dot after it
export function isHttpUrl(s: string): boolean;       // starts with http:// or https://
```
- `supportLinks` trims inputs, keeps `email` only if `isLikelyEmail`, `url` only if `isHttpUrl`, and sets `show`. This is the single source of truth for "what contact links to render" and also gates the settings-form validation. Pure → unit-tested.

### C) Branding on the public route — `lib/documents.ts` (`getDocumentByToken` / `PublicDocument`)

Extend the lookup to also load, for the document's org, branding + support + store address. Add to `PublicDocument`:
```ts
brandColor: string;            // tenantSettings.brandColor ?? "#10A765"
logoUrl: string | null;        // presigned R2 GET for tenantSettings.logoUrl, else null
storeAddress: string | null;
supportEmail: string | null;
supportUrl: string | null;
```
Implementation: the existing query already `LEFT JOIN store` + `INNER JOIN organization`; add a `LEFT JOIN tenantSettings ON organizationId` and select `brandColor`, `logoUrl`, `supportEmail`, `supportUrl`, and `store.address`. After the row loads, if `logoUrl` is set, mint a presigned GET (reuse `presignedDocumentUrl`/the storage presign for the logo key, 5-min TTL). The `ready→downloaded` flip + webhook are unchanged.

### D) Public page render — `app/(public)/d/[token]/page.tsx`

- **Header:** tenant logo `<img>` (presigned `logoUrl`) when present, else the org name styled as a wordmark.
- **Ready state:** brand-color accent on the check icon + the Download button (`style={{ backgroundColor: brandColor }}` / icon color); keep the image + download anchor.
- **Provenance:** "Issued by {organizationName} · {storeName}", `storeAddress` (when set), and the date (existing).
- **Support block:** compute `supportLinks({ supportEmail, supportUrl })`; when `show`, render "Questions about this order? Contact {storeName}" with a `mailto:{email}` link and/or a "Return policy & help" link to `url`. Hidden when `!show`.
- **Footer:** small muted "Powered by Maratus" (`MaratusWordmark` moved here from the header).
- pending / not-found states unchanged in logic; they may still show branding when the org resolves (not-found has no org → plain).

### E) Tenant settings form — wherever `tenantSettings` is edited (the Branding/Settings surface)

Add two inputs (Support email, Support / return-policy URL) to the existing tenant settings/branding form + its save server action. Persist to `supportEmail`/`supportUrl`; validate with `isLikelyEmail`/`isHttpUrl` (allow empty = clear the field). Record the existing `AUDIT.brandingUpdated` (or settings-updated) audit as that form already does.

## Data flow

```
Customer scans QR → /d/{token}
  getDocumentByToken(token): document ⋈ store ⋈ organization ⋈ tenantSettings
    → { status, image (presigned), orgName, storeName, storeAddress, date,
        brandColor, logoUrl (presigned), supportEmail, supportUrl }
  page renders: tenant logo + brand-color accents + provenance + support block + "Powered by Maratus"

Tenant settings form → save supportEmail/supportUrl (validated) → tenantSettings
```

## Error handling / edge cases

- **No tenantSettings row / null branding:** `brandColor` falls back to `#10A765`; `logoUrl` null → org-name wordmark; support block hidden.
- **Invalid stored support values** (shouldn't happen post-validation): `supportLinks` drops anything failing `isLikelyEmail`/`isHttpUrl`, so the public page never renders a broken `mailto:`/link.
- **Logo presign failure:** treat as no logo (fall back to wordmark) — never break the page.
- **not-found token:** unchanged graceful state (no org to brand).
- **XSS:** org/store/address/support values render as text (React escapes); `brandColor` is only used as an inline style value (a hex from our own settings) — validate it's a `#`-hex in the settings form to be safe, or clamp at render.

## Testing

- **Pure unit tests** (`lib/branding/support.test.ts`): `isLikelyEmail` (valid / no-@ / no-dot), `isHttpUrl` (http/https yes; `ftp:`/bare-domain no), `supportLinks` (both set → show with both; only email; only url; both blank → `show:false`; whitespace trimmed; invalid dropped).
- **Existing suite green** (`npm run test`, 305 → grows) + `npm run build` + `npx tsc --noEmit`.
- **Manual (deferred):** set support fields + a logo + brand color on a tenant → scan/open a `ready` `/d/{token}` → branded page with logo, accent color, provenance, and the support block; clear the fields → block hidden; a tenant with no branding → graceful default.

## Out of scope (deferred)

- Warranty/return *lookup* keyed on business data (needs structured ingest metadata — a firmware/ingest-contract change).
- White-label custom domains; multi-region R2.
- Document retention/expiry; customer identity / "all my documents".
- Full theming of the public page (only accent color, not a full palette swap).

**Phase 3 starts with 3A.** Subsequent Phase 3 work (if pursued) would each get its own spec.

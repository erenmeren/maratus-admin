# Phase 3A — Branded Customer Document Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the public `/d/{token}` page into a branded customer experience — tenant logo + brand-color accents + store provenance + an optional support/return-contact block.

**Architecture:** Two optional `tenantSettings` support columns; a pure `supportLinks` helper; the public document lookup extended to load branding + support + store address (logo presigned); the public page re-rendered with tenant branding; and a small dedicated support-contact settings form.

**Tech Stack:** Next.js 16 RSC public route, Drizzle/Neon, Cloudflare R2 presign (`presignedGetUrl`), Vitest (pure helper). Reuses `isValidHex` (`lib/color.ts`), the `MaratusWordmark` (`components/brand`), and the branding page.

## Global Constraints

- **Logo leads; Maratus → "Powered by Maratus" footer.** Tenant logo (presigned) in the header when set, else org-name wordmark.
- **Brand color is an accent only** (check icon + Download button), applied as an inline style from the hex; clamp to `#10A765` when the stored value fails `isValidHex` (guards inline-style injection).
- **Support fields optional**; the support block is hidden when both are blank. `supportLinks` is the single source of truth for what renders, and the same validators gate the settings form.
- **No owner-email exposure** on the public page.
- **Migration discipline:** `db:generate` on this repo emits spurious FK churn (snapshot drift) — hand-strip the generated SQL to ONLY the two `ADD COLUMN`s. Do NOT run `db:migrate` (deferred prod step).
- **Never break the public page:** a logo-presign failure or null branding falls back gracefully; the not-found/pending states keep working.
- Verification per task: `npm run test` (currently 305, stays green), `npm run build`, `npx tsc --noEmit`. Dev server on **:3001**.

## File Map

| File | Responsibility | Task |
|---|---|---|
| `lib/db/schema.ts` (modify) + `drizzle/0025_*.sql` (generated, stripped) | `supportEmail` + `supportUrl` columns | 1 |
| `lib/branding/support.ts` (new) + `.test.ts` | pure `supportLinks` + `isLikelyEmail` + `isHttpUrl` | 2 |
| `lib/documents.ts` (`PublicDocument` + `getDocumentByToken`) | branding/support/address on the public lookup | 3 |
| `app/(public)/d/[token]/page.tsx` (rewrite render) | branded page | 4 |
| `app/(tenant)/tenant/branding/support-actions.ts` (new) + `components/support-contact-form.tsx` (new) + `app/(tenant)/tenant/branding/page.tsx` + `lib/data.ts` `getTenantBranding` (modify) | settings form | 5 |

---

### Task 1: Support columns + migration

**Files:**
- Modify: `lib/db/schema.ts` (the `tenantSettings` table)
- Generate: `drizzle/0025_*.sql` (then hand-strip)

**Interfaces:**
- Produces: `tenantSettings.supportEmail` (`text`, nullable), `tenantSettings.supportUrl` (`text`, nullable).

- [ ] **Step 1: Add the columns to the schema**

In `lib/db/schema.ts`, the `tenantSettings` table has `logoUrl: text("logo_url"),` and `staffPin: text("staff_pin"),`. Add the two support columns right after `logoUrl`:

```ts
  logoUrl: text("logo_url"),
  // Optional customer-facing support contact, shown on the public /d/{token} page.
  supportEmail: text("support_email"),
  supportUrl: text("support_url"),
  staffPin: text("staff_pin"),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0025_*.sql`. It will likely contain spurious FK DROP/ADD churn (known snapshot drift on this repo).

- [ ] **Step 3: Strip the migration to ONLY the two ADD COLUMNs**

Open the generated `drizzle/0025_*.sql` and replace its entire contents with exactly:

```sql
ALTER TABLE "tenant_settings" ADD COLUMN "support_email" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "support_url" text;
```

(Delete any `DROP CONSTRAINT` / `ADD CONSTRAINT` / `DROP INDEX` / `CREATE INDEX` lines — they are drift artifacts, and prod already has those objects. Leave the generated `drizzle/meta/0025_snapshot.json` + `_journal.json` as drizzle wrote them.) Do NOT run `db:migrate`.

- [ ] **Step 4: Typecheck + build + suite**

Run: `npx tsc --noEmit && npm run build && npm run test`
Expected: no type errors; build OK; 305 green (additive column, no behavior touched).

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(branding): add tenantSettings.supportEmail + supportUrl columns (3A)"
```

---

### Task 2: Pure support-links helper

**Files:**
- Create: `lib/branding/support.ts`
- Test: `lib/branding/support.test.ts`

**Interfaces:**
- Produces:
  - `isLikelyEmail(s: string): boolean`
  - `isHttpUrl(s: string): boolean`
  - `interface SupportLinks { email: string | null; url: string | null; show: boolean }`
  - `supportLinks(input: { supportEmail: string | null; supportUrl: string | null }): SupportLinks`

- [ ] **Step 1: Write the failing test**

Create `lib/branding/support.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isLikelyEmail, isHttpUrl, supportLinks } from "./support";

describe("isLikelyEmail", () => {
  it("accepts a normal address", () => {
    expect(isLikelyEmail("help@roastwell.co")).toBe(true);
  });
  it("rejects missing @ or dot-after-@", () => {
    expect(isLikelyEmail("helproastwell.co")).toBe(false);
    expect(isLikelyEmail("help@localhost")).toBe(false);
    expect(isLikelyEmail("")).toBe(false);
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("https://roastwell.co/returns")).toBe(true);
    expect(isHttpUrl("http://x.test")).toBe(true);
  });
  it("rejects non-http(s) or bare domains", () => {
    expect(isHttpUrl("roastwell.co")).toBe(false);
    expect(isHttpUrl("ftp://x")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("supportLinks", () => {
  it("shows both when both valid", () => {
    expect(supportLinks({ supportEmail: "help@x.co", supportUrl: "https://x.co/h" })).toEqual({
      email: "help@x.co",
      url: "https://x.co/h",
      show: true,
    });
  });
  it("trims and drops invalid values", () => {
    expect(supportLinks({ supportEmail: "  help@x.co  ", supportUrl: "not-a-url" })).toEqual({
      email: "help@x.co",
      url: null,
      show: true,
    });
  });
  it("show:false when both blank/invalid", () => {
    expect(supportLinks({ supportEmail: null, supportUrl: "" })).toEqual({
      email: null,
      url: null,
      show: false,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/branding/support.test.ts`
Expected: FAIL — `Cannot find module './support'`.

- [ ] **Step 3: Write the implementation**

Create `lib/branding/support.ts`:

```ts
// lib/branding/support.ts
// Pure: validate + resolve the optional customer-support contact links shown on
// the public document page. Single source of truth for "what to render" and for
// the settings-form validation. No IO.

/** Basic shape check: has an "@" with a dotted domain after it. Not RFC-perfect — just enough to avoid rendering an obviously-broken mailto. */
export function isLikelyEmail(s: string): boolean {
  const at = s.indexOf("@");
  if (at <= 0) return false;
  const domain = s.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

/** Only http(s) absolute URLs are renderable as a safe external link. */
export function isHttpUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s);
}

export interface SupportLinks {
  email: string | null;
  url: string | null;
  show: boolean;
}

export function supportLinks(input: {
  supportEmail: string | null;
  supportUrl: string | null;
}): SupportLinks {
  const e = (input.supportEmail ?? "").trim();
  const u = (input.supportUrl ?? "").trim();
  const email = isLikelyEmail(e) ? e : null;
  const url = isHttpUrl(u) ? u : null;
  return { email, url, show: email != null || url != null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/branding/support.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm run test && npx tsc --noEmit`
Expected: all green, no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/branding/support.ts lib/branding/support.test.ts
git commit -m "feat(branding): pure support-links helper + validators (3A)"
```

---

### Task 3: Branding on the public document lookup

**Files:**
- Modify: `lib/documents.ts` (`PublicDocument` interface + `getDocumentByToken`)

**Interfaces:**
- Consumes: `tenantSettings`/`store` tables; `presignedGetUrl` (`lib/storage.ts`).
- Produces: `PublicDocument` gains `brandColor: string`, `logoUrl: string | null`, `storeAddress: string | null`, `supportEmail: string | null`, `supportUrl: string | null`.

- [ ] **Step 1: Extend the `PublicDocument` interface**

In `lib/documents.ts`, add to `interface PublicDocument` (after `imageUrl`):

```ts
  /** Tenant brand accent color (hex); defaults to "#10A765" when unset. */
  brandColor: string;
  /** Presigned tenant logo URL, or null when no logo. */
  logoUrl: string | null;
  storeAddress: string | null;
  supportEmail: string | null;
  supportUrl: string | null;
```

- [ ] **Step 2: Load branding + support + address in `getDocumentByToken`**

In `lib/documents.ts`, add the imports (extend the schema import to include `tenantSettings`; `presignedGetUrl` from storage):

```ts
import { tenantSettings } from "@/lib/db/schema";
import { presignedGetUrl } from "@/lib/storage";
```

Update the query's `.select({...})` and joins to also pull store address + tenant branding/support, and return the new fields. Replace the select + the joins block:

```ts
  const [row] = await db
    .select({
      document: documentTable,
      storeName: storeTable.name,
      storeAddress: storeTable.address,
      orgName: orgTable.name,
      brandColor: tenantSettings.brandColor,
      logoKey: tenantSettings.logoUrl,
      supportEmail: tenantSettings.supportEmail,
      supportUrl: tenantSettings.supportUrl,
    })
    .from(documentTable)
    .leftJoin(storeTable, eq(documentTable.storeId, storeTable.id))
    .innerJoin(orgTable, eq(documentTable.organizationId, orgTable.id))
    .leftJoin(tenantSettings, eq(documentTable.organizationId, tenantSettings.organizationId))
    .where(eq(documentTable.token, token))
    .limit(1);
```

(The existing `if (!row) return null;` and the `r = row.document` + image/flip logic stay unchanged.)

Then mint the logo presign and extend the return object. After the image/flip block and before the `return {`:

```ts
  let logoUrl: string | null = null;
  if (row.logoKey) {
    try {
      logoUrl = await presignedGetUrl(row.logoKey);
    } catch (err) {
      console.error("logo presign failed", err);
      logoUrl = null; // never break the page over a logo
    }
  }
```

And the `return {...}` becomes:

```ts
  return {
    token: r.token,
    status: r.status === "ready" ? "downloaded" : r.status,
    storeName: row.storeName,
    organizationName: row.orgName,
    mimeType: r.mimeType,
    createdAt: r.createdAt,
    imageUrl,
    brandColor: row.brandColor ?? "#10A765",
    logoUrl,
    storeAddress: row.storeAddress && row.storeAddress.trim() ? row.storeAddress : null,
    supportEmail: row.supportEmail ?? null,
    supportUrl: row.supportUrl ?? null,
  };
```

- [ ] **Step 3: Typecheck + build + suite**

Run: `npx tsc --noEmit && npm run build && npm run test`
Expected: no type errors; build OK; 305 green (the public-page consumer is updated in Task 4 — but since these are additive fields, the page still compiles until then because it reads existing fields).

- [ ] **Step 4: Commit**

```bash
git add lib/documents.ts
git commit -m "feat(branding): load brand color, logo, address + support on the public doc lookup (3A)"
```

---

### Task 4: Branded public page render

**Files:**
- Modify: `app/(public)/d/[token]/page.tsx`

**Interfaces:**
- Consumes: the extended `PublicDocument` (Task 3); `supportLinks` (Task 2); `isValidHex` (`lib/color.ts`); `MaratusWordmark` (`components/brand`).

- [ ] **Step 1: Rewrite the page to use branding**

Replace `app/(public)/d/[token]/page.tsx` with:

```tsx
import Link from "next/link";
import { Check, Download, Leaf, FileText, SearchX, Mail, ExternalLink } from "lucide-react";
import { MaratusWordmark } from "@/components/brand";
import { getDocumentByToken, type PublicDocument } from "@/lib/documents";
import { supportLinks } from "@/lib/branding/support";
import { isValidHex } from "@/lib/color";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const document = await getDocumentByToken(token);

  if (!document) return <DocumentNotFound />;

  const accent = isValidHex(document.brandColor) ? document.brandColor : "#10A765";

  if (document.status === "pending" || !document.imageUrl) {
    return (
      <Shell brand={document}>
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FileText className="size-6" />
          </span>
          <h1 className="font-display text-lg font-bold">Almost ready</h1>
          <p className="max-w-xs text-sm text-muted-foreground">
            Your document is still being prepared. Refresh in a moment.
          </p>
        </div>
      </Shell>
    );
  }

  const dateStr = document.createdAt.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const support = supportLinks(document);

  return (
    <Shell brand={document}>
      <div className="flex flex-col items-center gap-2 border-b px-6 py-6 text-center">
        <span
          className="flex size-11 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: accent }}
        >
          <Check className="size-6" />
        </span>
        <h1 className="font-display text-lg font-bold">Document ready</h1>
        <p className="text-xs text-muted-foreground">
          Issued by {document.organizationName}
          {document.storeName ? ` · ${document.storeName}` : ""}
        </p>
        {document.storeAddress && (
          <p className="text-xs text-muted-foreground">{document.storeAddress}</p>
        )}
        <p className="text-xs text-muted-foreground">{dateStr}</p>
      </div>

      {/* Rendered document image from R2 (short-lived presigned URL) */}
      <div className="bg-muted/30 p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={document.imageUrl}
          alt="Your document"
          className="mx-auto w-full max-w-xs rounded-lg border bg-white shadow-sm"
        />
      </div>

      <div className="px-6 pb-4 pt-4">
        <a
          href={document.imageUrl}
          download
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: accent }}
        >
          <Download className="size-4" /> Download document
        </a>
      </div>

      {support.show && (
        <div className="border-t px-6 py-4 text-center text-xs text-muted-foreground">
          <p className="mb-1.5">
            Questions about this{document.storeName ? `? Contact ${document.storeName}` : "?"}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            {support.email && (
              <a href={`mailto:${support.email}`} className="inline-flex items-center gap-1 font-medium hover:underline">
                <Mail className="size-3.5" /> {support.email}
              </a>
            )}
            {support.url && (
              <a href={support.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline">
                <ExternalLink className="size-3.5" /> Return policy &amp; help
              </a>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, brand }: { children: React.ReactNode; brand?: Pick<PublicDocument, "logoUrl" | "organizationName"> }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex justify-center">
          {brand?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.organizationName} className="h-10 w-auto object-contain" />
          ) : brand?.organizationName ? (
            <span className="font-display text-lg font-bold">{brand.organizationName}</span>
          ) : null}
        </div>
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          {children}
        </div>
        <div className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Leaf className="size-3.5 text-primary" />
          <span className="inline-flex items-center gap-1">A paperless document, powered by</span>
          <MaratusWordmark subtle />
        </div>
      </div>
    </div>
  );
}

function DocumentNotFound() {
  return (
    <Shell>
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <SearchX className="size-6" />
        </span>
        <h1 className="font-display text-lg font-bold">Document not found</h1>
        <p className="max-w-xs text-sm text-muted-foreground">
          This link is invalid or has expired. Ask the store to re-issue your
          document.
        </p>
        <Link href="/" className="text-sm font-medium text-primary hover:underline">
          Go to Maratus
        </Link>
      </div>
    </Shell>
  );
}
```

(Notes: the not-found state calls `<Shell>` with no `brand`, so it shows just the Maratus footer — unchanged behavior. The pending state now passes `brand` so it carries the tenant logo. The `MaratusWordmark` moved into the footer.)

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build OK; the `/d/[token]` route compiles. (If `MaratusWordmark` doesn't accept the `subtle` prop in a footer context, keep it as-is — it was already used with `subtle`.)

- [ ] **Step 3: Commit**

```bash
git add "app/(public)/d/[token]/page.tsx"
git commit -m "feat(branding): branded public document page — logo, accent, provenance, support (3A)"
```

---

### Task 5: Tenant support-contact settings form

**Files:**
- Create: `app/(tenant)/tenant/branding/support-actions.ts`
- Create: `components/support-contact-form.tsx`
- Modify: `lib/data.ts` (`getTenantBranding`)
- Modify: `app/(tenant)/tenant/branding/page.tsx`

**Interfaces:**
- Consumes: `isLikelyEmail`/`isHttpUrl` (Task 2); `requireTenant`; `tenantSettings`; `recordAudit`/`AUDIT`.
- Produces: `saveSupportContact(formData: FormData): Promise<{ ok: boolean; error?: string }>`; `getTenantBranding` returns `supportEmail`/`supportUrl`.

- [ ] **Step 1: Return support fields from `getTenantBranding`**

In `lib/data.ts`, `getTenantBranding` reads `tenantSettings`. Add `supportEmail` and `supportUrl` to what it selects and returns (mirror how it returns `brandColor`):

```ts
    supportEmail: settings?.supportEmail ?? null,
    supportUrl: settings?.supportUrl ?? null,
```

(Add these to the returned object; ensure the underlying select includes `tenantSettings.supportEmail`/`tenantSettings.supportUrl` if it uses an explicit column projection — if it selects the whole row, no projection change is needed.)

- [ ] **Step 2: Create the save action**

Create `app/(tenant)/tenant/branding/support-actions.ts`:

```ts
"use server";

// Persist the optional customer-facing support contact (shown on /d/{token}).
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { isLikelyEmail, isHttpUrl } from "@/lib/branding/support";
import { recordAudit, AUDIT } from "@/lib/audit";

export interface SaveSupportResult {
  ok: boolean;
  error?: string;
}

export async function saveSupportContact(formData: FormData): Promise<SaveSupportResult> {
  const { ctx, organizationId } = await requireTenant();
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "You don't have permission to edit this." };
  }

  const emailRaw = String(formData.get("supportEmail") ?? "").trim();
  const urlRaw = String(formData.get("supportUrl") ?? "").trim();
  if (emailRaw && !isLikelyEmail(emailRaw)) {
    return { ok: false, error: "Enter a valid support email, or leave it blank." };
  }
  if (urlRaw && !isHttpUrl(urlRaw)) {
    return { ok: false, error: "Enter a full http(s) URL, or leave it blank." };
  }

  await db
    .insert(tenantSettings)
    .values({ organizationId, supportEmail: emailRaw || null, supportUrl: urlRaw || null })
    .onConflictDoUpdate({
      target: tenantSettings.organizationId,
      set: { supportEmail: emailRaw || null, supportUrl: urlRaw || null, updatedAt: new Date() },
    });

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.brandingUpdated,
  });
  revalidatePath("/tenant/branding");
  return { ok: true };
}
```

- [ ] **Step 3: Create the form component**

Create `components/support-contact-form.tsx`:

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { saveSupportContact } from "@/app/(tenant)/tenant/branding/support-actions";

export function SupportContactForm({
  initialEmail,
  initialUrl,
  canEdit,
}: {
  initialEmail: string | null;
  initialUrl: string | null;
  canEdit: boolean;
}) {
  const [pending, setPending] = React.useState(false);

  async function action(formData: FormData) {
    setPending(true);
    const res = await saveSupportContact(formData);
    setPending(false);
    if (res.ok) toast.success("Support contact saved");
    else toast.error("Couldn't save", { description: res.error });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Customer support contact</CardTitle>
        <CardDescription>
          Optional. Shown to customers on the document page they scan. Leave blank to hide.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-muted-foreground">Support email</span>
            <Input name="supportEmail" type="email" defaultValue={initialEmail ?? ""} placeholder="help@yourstore.com" disabled={!canEdit} />
          </label>
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-muted-foreground">Return policy / help URL</span>
            <Input name="supportUrl" type="url" defaultValue={initialUrl ?? ""} placeholder="https://yourstore.com/returns" disabled={!canEdit} />
          </label>
          {canEdit && (
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Render the form on the branding page**

In `app/(tenant)/tenant/branding/page.tsx`, import the form and render it after the `<BrandingEditor … />`:

```tsx
import { SupportContactForm } from "@/components/support-contact-form";
```

```tsx
      <BrandingEditor
        /* …existing props… */
      />
      <div className="mt-6">
        <SupportContactForm
          initialEmail={branding.supportEmail}
          initialUrl={branding.supportUrl}
          canEdit={canEdit}
        />
      </div>
```

- [ ] **Step 5: Typecheck + build + suite**

Run: `npx tsc --noEmit && npm run build && npm run test`
Expected: no type errors; build OK; 305 green.

- [ ] **Step 6: Commit**

```bash
git add lib/data.ts "app/(tenant)/tenant/branding/support-actions.ts" components/support-contact-form.tsx "app/(tenant)/tenant/branding/page.tsx"
git commit -m "feat(branding): tenant support-contact settings form (3A)"
```

---

## Deferred acceptance (manual / prod — user)

- `npm run db:migrate` to add the two columns to prod Neon (additive/safe).
- On `/tenant/branding`: set a support email + return URL → save; scan/open a `ready` `/d/{token}` for that org → branded page with the tenant logo, accent-colored check + Download button, "Issued by … · store · address", and the support block; clear the fields → block hidden; an org with no branding → graceful default (Maratus wordmark only, green accent).

---

## Self-Review

**Spec coverage:**
- Two optional `tenantSettings` support columns + migration (churn-stripped) (spec §A) → Task 1. ✅
- Pure `supportLinks`/validators (spec §B) → Task 2. ✅
- Branding/support/address on the public lookup, logo presigned (spec §C) → Task 3. ✅
- Branded page: logo, brand-color accent, provenance + address, support block, Maratus footer (spec §D) → Task 4. ✅
- Tenant support-contact settings form + action (spec §E) → Task 5. ✅
- Brand-color clamp via `isValidHex`, graceful logo/null fallbacks, no owner-email exposure (spec error-handling/decisions) → Tasks 3 & 4. ✅
- Testing: pure unit tests (Task 2) + deferred manual checks (spec §Testing). ✅

**Placeholder scan:** None — every step shows complete code. ✅

**Type consistency:** `PublicDocument` gains `brandColor/logoUrl/storeAddress/supportEmail/supportUrl` (Task 3) consumed by the page (Task 4); `supportLinks(input)` shape matches both the page (Task 4) and is the same validators used in the action (Task 5); `getTenantBranding` gains `supportEmail/supportUrl` (Task 5) consumed by the branding page → `SupportContactForm`; `accent` derived via `isValidHex`. ✅

**Note for implementers:** Task 3's added fields are additive, so the page keeps compiling before Task 4; Task 4 is the consumer. The `saveSupportContact` upsert sets only the support columns (plus `updatedAt`) — it does NOT touch `brandColor`/printer config, so it composes cleanly with the existing `saveBranding` action (separate forms, same table, disjoint columns).

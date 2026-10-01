# Dashboard Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize headings, spacing, and detail-page chrome across every admin + tenant dashboard page by routing them all through three shared layout primitives.

**Architecture:** Extend the existing `PageHeader` and add two sibling primitives (`SectionHeader`, `PageSection`). Then migrate the divergent pages (five that re-pad themselves, three detail pages with hand-rolled headers) onto the primitives and delete their bespoke markup. Presentational-only refactor — no data layer, route, or auth changes.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, TypeScript (strict), Tailwind v4, shadcn/ui (`radix-nova`), lucide-react. Path alias `@/*` → repo root.

## Global Constraints

- **Scope is dashboard pages only:** `app/(admin)/*` and `app/(tenant)/*`. Do **not** touch `app/(auth)/*` or `app/page.tsx` — their distinct layouts are intentional.
- **All new `PageHeader` props are optional** — the ~13 pages already using it must compile and render unchanged.
- **Canonical type styles (do not deviate):** page title h1 = `font-display text-2xl font-bold tracking-tight`; section title h2 = `text-lg font-medium tracking-tight`; description/meta = `text-sm text-muted-foreground`.
- **Spacing rhythm:** page container padding + `space-y-6` between top-level blocks are owned by `AppShell` — pages MUST return a fragment and never re-pad. Section heading→body = `space-y-3`. Metric grids = `grid gap-4`. Major column splits = `grid gap-6`.
- **No unit tests for these presentational primitives** (per spec). Verification is `npm run build` (typecheck) + visual render with the seed logins.
- **Seed logins:** platform admin `admin@maratus.app` / `123456`; tenant owner `dana@roastwell.co` / `123456`. Dev server: `npm run dev` → http://localhost:3000.
- Follow AGENTS.md: this is a modified Next.js — check `node_modules/next/dist/docs/` before using unfamiliar APIs.

---

## File Structure

**New files:**
- `components/section-header.tsx` — section-title primitive (`<h2>` + optional description + optional actions).
- `components/page-section.tsx` — standalone-section wrapper (`space-y-3` + optional `SectionHeader`).

**Modified — primitives:**
- `components/page-header.tsx` — add `backHref`/`backLabel`/`leading`/`badge`; widen `description` to `React.ReactNode`.

**Modified — page migrations:**
- `app/(tenant)/tenant/activity/page.tsx`, `app/(tenant)/tenant/members/page.tsx`, `app/(tenant)/tenant/billing/page.tsx`, `app/(admin)/admin/health/page.tsx`, `app/(admin)/admin/firmware/page.tsx` — drop self-padding, use `PageHeader`/`PageSection`.
- `app/(admin)/admin/customers/[tenantId]/page.tsx`, `app/(admin)/admin/devices/[deviceId]/page.tsx`, `app/(tenant)/tenant/stores/[storeId]/page.tsx` — migrate detail headers + section headings.

**Modified — docs:**
- `CLAUDE.md` — add a "Layout & spacing" note.

---

## Task 1: SectionHeader + PageSection primitives

**Files:**
- Create: `components/section-header.tsx`
- Create: `components/page-section.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`.
- Produces:
  - `SectionHeader({ title: string, description?: React.ReactNode, children?: React.ReactNode, className?: string })` — renders `<h2 className="text-lg font-medium tracking-tight">`, optional muted description, optional right-aligned `children` (actions).
  - `PageSection({ title?: string, description?: React.ReactNode, actions?: React.ReactNode, children: React.ReactNode, className?: string })` — renders `<section className="space-y-3 …">`, an optional `SectionHeader` at top, then `children`.

- [ ] **Step 1: Create `components/section-header.tsx`**

```tsx
import { cn } from "@/lib/utils";

export function SectionHeader({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1">
        <h2 className="text-lg font-medium tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Create `components/page-section.tsx`**

```tsx
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/section-header";

export function PageSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {title && (
        <SectionHeader title={title} description={description}>
          {actions}
        </SectionHeader>
      )}
      {children}
    </section>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build succeeds (no type errors). If the build is slow, `npx tsc --noEmit` is an acceptable faster proxy for the type check.

- [ ] **Step 4: Commit**

```bash
git add components/section-header.tsx components/page-section.tsx
git commit -m "feat(ui): add SectionHeader and PageSection primitives"
```

---

## Task 2: Extend PageHeader

**Files:**
- Modify: `components/page-header.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`, `Link` from `next/link`, `ArrowLeft` from `lucide-react`.
- Produces: `PageHeader({ title: string, description?: React.ReactNode, badge?: React.ReactNode, leading?: React.ReactNode, backHref?: string, backLabel?: string, children?: React.ReactNode, className?: string })`. New props are optional; `description` widened from `string` to `React.ReactNode`. `backHref` renders an `ArrowLeft` back-link row above the header; `leading` renders left of the title block; `badge` renders inline immediately after the title; `children` remains the right-aligned actions cluster.

- [ ] **Step 1: Replace the entire contents of `components/page-header.tsx`**

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  badge,
  leading,
  backHref,
  backLabel,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  leading?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          {leading}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-bold tracking-tight">
                {title}
              </h1>
              {badge}
            </div>
            {description && (
              <div className="text-sm text-muted-foreground">{description}</div>
            )}
          </div>
        </div>
        {children && <div className="flex items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}
```

> Note: description now renders inside a `<div>` (was `<p>`) so it can carry an icon+text metadata row. A plain string still renders correctly.

- [ ] **Step 2: Typecheck the whole app (verifies the ~13 existing callers still satisfy the signature)**

Run: `npm run build`
Expected: build succeeds. No caller passes a now-removed prop; every existing usage only sets `title`/`description`/`children`, all still valid.

- [ ] **Step 3: Visual smoke — an unchanged PageHeader page must look identical**

Run `npm run dev`, log in as `admin@maratus.app` / `123456`, open http://localhost:3000/admin (the Overview page — an unchanged caller). Confirm the title still reads as `font-display` bold 2xl and the layout is unchanged. (Use the browse skill or Playwright MCP for a screenshot if available.)

- [ ] **Step 4: Commit**

```bash
git add components/page-header.tsx
git commit -m "feat(ui): extend PageHeader with back-link, leading, badge, node description"
```

---

## Task 3: Migrate the five re-padding outliers

**Files:**
- Modify: `app/(tenant)/tenant/activity/page.tsx`
- Modify: `app/(tenant)/tenant/members/page.tsx`
- Modify: `app/(tenant)/tenant/billing/page.tsx`
- Modify: `app/(admin)/admin/health/page.tsx`
- Modify: `app/(admin)/admin/firmware/page.tsx`

**Interfaces:**
- Consumes: `PageHeader` (Task 2), `PageSection` (Task 1).

Each page currently wraps its body in a self-padded `<div className="flex flex-col gap-{6,8} p-6">` and hand-rolls its title. The fix is identical in shape: return a fragment (`<>…</>`), replace the title with `<PageHeader>`, and wrap standalone (non-Card) sections in `<PageSection>`. Removing the wrapper's `p-6` is what fixes the uneven left/top margin; removing the hand-rolled `<h1>` is what fixes the heading size.

- [ ] **Step 1: `tenant/activity` — add import, swap wrapper + title**

Add to the imports: `import { PageHeader } from "@/components/page-header";`
Replace the opening wrapper `<div className="flex flex-col gap-6 p-6">` with `<>`, replace `<h1 className="text-2xl font-semibold tracking-tight">Activity</h1>` with `<PageHeader title="Activity" />`, and replace the matching closing `</div>` with `</>`.

- [ ] **Step 2: `tenant/members` — same transformation**

Add `import { PageHeader } from "@/components/page-header";`
`<div className="flex flex-col gap-6 p-6">` → `<>`; `<h1 className="text-2xl font-semibold tracking-tight">Members</h1>` → `<PageHeader title="Members" />`; closing `</div>` → `</>`.

- [ ] **Step 3: `tenant/billing` — wrapper, title with description, and PageSection**

Add `import { PageHeader } from "@/components/page-header";` and `import { PageSection } from "@/components/page-section";`

Replace this block:
```tsx
<div className="flex flex-col gap-8 p-6">
  <header>
    <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
    <p className="text-muted-foreground">Manage your prepaid credit balance.</p>
  </header>
```
with:
```tsx
<>
  <PageHeader title="Billing" description="Manage your prepaid credit balance." />
```
Replace the credit-usage section opener `<section className="flex flex-col gap-3">` + its `<h2 className="text-lg font-medium">Credit usage this month</h2>` with `<PageSection title="Credit usage this month">` (drop the `<h2>`), and change that section's closing `</section>` to `</PageSection>`. Change the outermost closing `</div>` to `</>`.

- [ ] **Step 4: `admin/health` — wrapper, title, three PageSections**

Add `import { PageHeader } from "@/components/page-header";` and `import { PageSection } from "@/components/page-section";`

Replace `<div className="flex flex-col gap-8 p-6">` with `<>` and `<h1 className="text-2xl font-semibold tracking-tight">Platform health</h1>` with `<PageHeader title="Platform health" />`. For each of the three sections shaped `<section className="flex flex-col gap-3"><h2 className="text-lg font-medium">TITLE</h2>…</section>` ("Fleet freshness", "Trigger activity", "Per-tenant usage"), replace the opener + `<h2>` with `<PageSection title="TITLE">` and the closing `</section>` with `</PageSection>`. Change the outer closing `</div>` to `</>`.

- [ ] **Step 5: `admin/firmware` — wrapper + title with description**

Add `import { PageHeader } from "@/components/page-header";`

Replace this block:
```tsx
<div className="flex flex-col gap-6 p-6">
  <div>
    <h1 className="text-xl font-medium">Firmware</h1>
    <p className="text-sm text-muted-foreground">
      Upload a build (its version must match the binary&apos;s CONFIG_MARATUS_FW_VERSION). The newest
      release is what devices fetch via the OTA manifest.
    </p>
  </div>
```
with:
```tsx
<>
  <PageHeader
    title="Firmware"
    description="Upload a build (its version must match the binary's CONFIG_MARATUS_FW_VERSION). The newest release is what devices fetch via the OTA manifest."
  />
```
Change the matching outer closing `</div>` to `</>`.

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: build succeeds. Watch for an unbalanced-tag error (a leftover `</div>` or `</section>`) — fix any that appear.

- [ ] **Step 7: Visual verification**

Run `npm run dev`. As `dana@roastwell.co` open `/tenant/activity`, `/tenant/members`, `/tenant/billing`; as `admin@maratus.app` open `/admin/health`, `/admin/firmware`. Confirm on each: the left/top margin matches a known-good page (e.g. `/tenant/branding`), the title is `font-display` bold 2xl, and section headings are uniform. Compare margins side by side with `/admin` overview.

- [ ] **Step 8: Commit**

```bash
git add "app/(tenant)/tenant/activity/page.tsx" "app/(tenant)/tenant/members/page.tsx" "app/(tenant)/tenant/billing/page.tsx" "app/(admin)/admin/health/page.tsx" "app/(admin)/admin/firmware/page.tsx"
git commit -m "refactor(ui): route the five re-padding pages through PageHeader/PageSection"
```

---

## Task 4: Migrate detail-page headers + section headings

**Files:**
- Modify: `app/(admin)/admin/customers/[tenantId]/page.tsx`
- Modify: `app/(admin)/admin/devices/[deviceId]/page.tsx`
- Modify: `app/(tenant)/tenant/stores/[storeId]/page.tsx`

**Interfaces:**
- Consumes: `PageHeader` (Task 2, with `backHref`/`backLabel`/`leading`/`badge`/node `description`), `SectionHeader` (Task 1).

- [ ] **Step 1: `admin/customers/[tenantId]` — collapse back-link + Card header into PageHeader**

Ensure `PageHeader` is imported. Remove the standalone back-link `<Link href="/admin/customers">…Customers…</Link>` and the entire `{/* Header card */}` `<Card><CardContent …>…</CardContent></Card>` block, and replace both with:
```tsx
<PageHeader
  title={tenant.name}
  backHref="/admin/customers"
  backLabel="Customers"
  leading={
    <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 font-display text-2xl font-bold text-primary">
      {tenant.name.slice(0, 1)}
    </span>
  }
  badge={<TenantStatusBadge status={tenant.status} />}
  description={
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <span className="flex items-center gap-1.5">
        <Mail className="size-3.5" /> {tenant.contact.email}
      </span>
      <span className="flex items-center gap-1.5">
        <Phone className="size-3.5" /> {tenant.contact.phone}
      </span>
    </div>
  }
>
  <AddBranchDialog organizationId={tenant.id} customerName={tenant.name} />
</PageHeader>
```
If `Card`/`CardContent` are now unused in this file, remove them from the imports (the build will warn on unused imports under strict lint — check and clean up).

- [ ] **Step 2: `admin/customers/[tenantId]` — "Activity" section heading**

Replace `<h2 className="text-lg font-medium">Activity</h2>` with `<SectionHeader title="Activity" />` and add `import { SectionHeader } from "@/components/section-header";`.

- [ ] **Step 3: `admin/devices/[deviceId]` — fold back-link into PageHeader**

Remove the standalone `<Link href="/admin/devices">…Device Fleet…</Link>` and change the existing `<PageHeader title={device.name} description={`Printer at ${store.name}`} />` to:
```tsx
<PageHeader
  title={device.name}
  description={`Printer at ${store.name}`}
  backHref="/admin/devices"
  backLabel="Device Fleet"
/>
```
Replace `<h2 className="text-lg font-medium">Remote control</h2>` with `<SectionHeader title="Remote control" />` and add the `SectionHeader` import. If `ArrowLeft` / `Link` are now unused, remove them from imports.

- [ ] **Step 4: `tenant/stores/[storeId]` — fold back-link + address into PageHeader, move status to badge**

Remove the standalone `<Link href="/tenant/stores">…Stores…</Link>` and the `-mt-2` address paragraph:
```tsx
<p className="-mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
  <MapPin className="size-3.5" />
  {store.address}
</p>
```
Change the header to:
```tsx
<PageHeader
  title={store.name}
  backHref="/tenant/stores"
  backLabel="Stores"
  badge={<StatusBadge status={rollup} />}
  description={
    <span className="flex items-center gap-1.5">
      <MapPin className="size-3.5" />
      {store.address}
    </span>
  }
>
  {canClaim && (
    <StoreEditButton
      store={{
        id: store.id,
        name: store.name,
        address: store.address,
        timezone: store.timezone,
      }}
    />
  )}
  {canClaim && <ClaimDeviceDialog storeId={store.id} />}
</PageHeader>
```
(The `StatusBadge` moves from a right-aligned child to the inline `badge` slot — matching the customer detail page.)

- [ ] **Step 5: `tenant/stores/[storeId]` — "Printers in this store" section**

Replace:
```tsx
<div>
  <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
    Printers in this store
  </h2>
```
with `<PageSection title="Printers in this store">` and change its closing `</div>` to `</PageSection>`. Add `import { PageSection } from "@/components/page-section";`. If `ArrowLeft` / `Link` are now unused in this file, remove them from imports.

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: build succeeds. Resolve any unused-import lint errors surfaced by the removed `Card`/`Link`/`ArrowLeft`.

- [ ] **Step 7: Visual verification**

Run `npm run dev`. As `admin@maratus.app`, open a customer detail (`/admin/customers/…` via the Customers list) and a device detail (`/admin/devices/…` via Device Fleet). As `dana@roastwell.co`, open a store detail (`/tenant/stores/…`). Confirm each: back-link renders above the title, title is `font-display` bold 2xl, status badge sits inline next to the title, address/contact render as the muted description, and section headings are the uniform `text-lg font-medium`. Confirm the customer header is no longer boxed in a Card.

- [ ] **Step 8: Commit**

```bash
git add "app/(admin)/admin/customers/[tenantId]/page.tsx" "app/(admin)/admin/devices/[deviceId]/page.tsx" "app/(tenant)/tenant/stores/[storeId]/page.tsx"
git commit -m "refactor(ui): migrate detail-page headers and section headings onto primitives"
```

---

## Task 5: Grid-gap sweep, docs, and full-app visual pass

**Files:**
- Modify: `CLAUDE.md`
- Possibly modify: any dashboard page with a stray grid gap (sweep result)

**Interfaces:**
- Consumes: nothing new. This task documents the rhythm and verifies the whole surface.

- [ ] **Step 1: Grid-gap sweep**

Run: `grep -rn "grid gap-" app/\(admin\) app/\(tenant\) --include=page.tsx`
For each hit, confirm it follows the convention: metric/card grids use `gap-4`; major main+aside column splits (`lg:grid-cols-3` / `lg:col-span-2` layouts) use `gap-6`. Fix any stray that clearly violates its role (e.g. a metric-card grid using `gap-6`). Do not change gaps that already match their role. If the sweep finds no violations, record that and make no code change here.

- [ ] **Step 2: Add the "Layout & spacing" note to `CLAUDE.md`**

Under the `## Architecture` section (after the `middleware.ts` bullet), add:
```markdown
- **Layout & spacing (dashboard pages).** Every `/admin` + `/tenant` page returns
  a fragment and inherits the shell's container — never re-pad a page. Chrome comes
  from three primitives: `PageHeader` (one page title; supports `backHref`/`leading`/
  `badge`/node `description`), `SectionHeader` (one section title), and `PageSection`
  (standalone non-Card section, `space-y-3`). Rhythm: page container `max-w-7xl` +
  `p-4 sm:p-6 lg:p-8` and `space-y-6` between top-level blocks are owned by
  `AppShell`; section heading→body is `space-y-3`; metric grids `gap-4`; major
  column splits `gap-6`. Type: h1 `font-display text-2xl font-bold`, h2 `text-lg
  font-medium`, description `text-sm text-muted-foreground`.
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Full-app visual pass (both realms, both themes)**

Run `npm run dev`. Walk every dashboard page in both realms and confirm uniform left/top margin, h1 size/weight, and section-heading style, with no double-padding and no regression:
- Admin (`admin@maratus.app`): `/admin`, `/admin/customers`, a customer detail, `/admin/devices`, a device detail, `/admin/firmware`, `/admin/health`, `/admin/billing`.
- Tenant (`dana@roastwell.co`): `/tenant`, `/tenant/stores`, a store detail, `/tenant/branding`, `/tenant/members`, `/tenant/api`, `/tenant/reports`, `/tenant/analytics`, `/tenant/device-settings`, `/tenant/activity`, `/tenant/billing`.
Spot-check `/admin/health` and a store detail in both light and dark mode (theme toggle in the top bar).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
# add any page files changed by the gap sweep, e.g.:
# git add "app/(tenant)/tenant/<page>.tsx"
git commit -m "docs(ui): document dashboard layout rhythm; normalize stray grid gaps"
```

---

## Self-Review

**Spec coverage:**
- Part 1 (primitives): `PageHeader` extension → Task 2; `SectionHeader` + `PageSection` → Task 1. ✅
- Part 2 (spacing rhythm doc): → Task 5 Step 2. ✅
- Part 3.A (five outliers) → Task 3. ✅
- Part 3.B (detail pages) → Task 4 Steps 1,3,4. ✅
- Part 3.C (section headings) → Task 3 (billing/health, via PageSection) + Task 4 Steps 2,3,5. ✅
- Part 3.D (grid gaps) → Task 5 Step 1. ✅
- Verification (build + visual + themes) → per-task Steps + Task 5 Step 4. ✅

**Type consistency:** `PageHeader` props (`backHref`, `backLabel`, `leading`, `badge`, node `description`) are defined in Task 2 and used with those exact names in Tasks 3–4. `SectionHeader({title, description, children})` and `PageSection({title, description, actions, children})` defined in Task 1, used consistently in Tasks 3–4. No name drift.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; migration steps give exact old→new markup. The gap sweep (Task 5 Step 1) is a conditional check with an explicit "no violations → no change" branch rather than a vague instruction.

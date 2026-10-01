# Dashboard Design System — Standardizing Page Styling

**Date:** 2026-07-07
**Status:** Approved design, pre-implementation
**Scope:** In-app dashboard pages only (`app/(admin)/*`, `app/(tenant)/*`). Auth
pages (`app/(auth)/*`) and the marketing landing page (`app/page.tsx`) keep their
intentionally distinct layouts and are **out of scope**.

## Problem

Page styling across the admin console is inconsistent: heading sizes differ,
paragraph/section spacing varies, and left/top margins are uneven from page to
page. Root cause is not a missing container — `AppShell` already wraps every
dashboard page in `<main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto
max-w-7xl space-y-6">`. The inconsistency comes from a handful of pages
bypassing that shared chrome:

1. **Five pages re-pad themselves.** `tenant/activity`, `tenant/members`,
   `tenant/billing`, `admin/health`, and `admin/firmware` each wrap their body
   in their own `<div className="flex flex-col gap-{6,8} p-6">`. This stacks an
   extra `p-6` on top of the shell padding (their content is inset further than
   every other page) and swaps the shell's `space-y-6` rhythm for an ad-hoc
   `gap-6`/`gap-8`.

2. **Three different page-title (h1) styles.**
   - `PageHeader` (used by ~13 pages): `font-display text-2xl font-bold tracking-tight` ✅ canonical
   - Hand-rolled in the five outliers: `text-2xl font-semibold tracking-tight` (no display face, lighter weight)
   - `admin/firmware`: `text-xl font-medium` (smaller *and* lighter — the worst outlier)

3. **Two section-heading (h2) styles.** `text-lg font-medium` (dominant) vs a
   one-off `text-sm font-semibold text-muted-foreground` ("Printers in this
   store" on `tenant/stores/[storeId]`).

4. **Duplicated detail-page chrome.** The back-link markup (`ArrowLeft` + label)
   is copy-pasted in `admin/customers/[tenantId]`, `admin/devices/[deviceId]`,
   and `tenant/stores/[storeId]`. `tenant/stores/[storeId]` uses a `-mt-2` hack
   to fit an address line under the title. `admin/customers/[tenantId]` wraps its
   header in a one-off `Card` with an avatar, status badge, and contact row.

## Approach

Establish a small set of layout primitives as the single source of truth for
page/section chrome, document the spacing rhythm in one place, then migrate every
dashboard page onto the primitives. All new component props are optional so the
~13 pages already using `PageHeader` need no changes.

## Part 1 — Primitive components

### `PageHeader` (extend `components/page-header.tsx`)

The one page-title primitive. Current props (`title`, `description`, `children`,
`className`) are preserved; the following are added, all optional:

```tsx
PageHeader({
  title: string,
  description?: React.ReactNode,   // widened from string → supports a metadata row (address, contact)
  badge?: React.ReactNode,         // inline after the title (status badge on detail pages)
  leading?: React.ReactNode,       // left of the title block (avatar)
  backHref?: string,               // renders an ArrowLeft back-link row above the header
  backLabel?: string,              // label for the back link (e.g. "Customers")
  children?: React.ReactNode,      // right-aligned actions (unchanged)
  className?: string,
})
```

Rendering:

```
[back-link row]        // only when backHref is set: ArrowLeft + backLabel, muted, hover:text-foreground
[header row: flex, items-end, justify-between]
  [left: leading?  +  <div space-y-1>
                        <div flex items-center gap-2> h1 + badge? </div>
                        description?
                      </div>]
  [right: children]    // actions cluster
```

- h1: `font-display text-2xl font-bold tracking-tight` (unchanged canonical style)
- description: `text-sm text-muted-foreground`
- `description` accepts a node so a metadata line (icon + text) can render in the
  same muted slot — replaces the `-mt-2` address hack.
- back-link markup lives here once, replacing three copies.

### `SectionHeader` (new `components/section-header.tsx`)

The one section-title primitive.

```tsx
SectionHeader({
  title: string,
  description?: React.ReactNode,
  children?: React.ReactNode,   // right-aligned actions
  className?: string,
})
```

- h2: `text-lg font-medium tracking-tight`
- description: `text-sm text-muted-foreground`
- Replaces every hand-rolled `<h2 className="text-lg font-medium">` and the
  one-off `text-sm font-semibold text-muted-foreground` heading (normalized up to
  the standard size).

### `PageSection` (new `components/page-section.tsx`)

Standardizes the heading→body rhythm for standalone (non-`Card`) sections.

```tsx
PageSection({
  title?: string,
  description?: React.ReactNode,
  actions?: React.ReactNode,
  children: React.ReactNode,
  className?: string,
})
// renders:
// <section className={cn("space-y-3", className)}>
//   {title && <SectionHeader title description>{actions}</SectionHeader>}
//   {children}
// </section>
```

Replaces the ad-hoc `<section className="flex flex-col gap-3">` / bare `<div>`
section wrappers in `admin/health`, `tenant/billing`, and `tenant/stores/[storeId]`.

## Part 2 — Spacing rhythm

A single documented scale. Each value has one owner; pages never re-pad.

| Role | Value | Owner |
|---|---|---|
| Page container | `max-w-7xl` + `p-4 sm:p-6 lg:p-8` | `AppShell` (pages must **not** re-pad) |
| Between top-level page blocks | `space-y-6` | `AppShell` |
| Section heading → body | `space-y-3` | `PageSection` |
| Metric / card grids | `grid gap-4` | convention |
| Major column split (main + aside) | `grid gap-6` | convention |

This table is added to `CLAUDE.md` as a short "Layout & spacing" note so the
convention is discoverable and does not drift.

## Part 3 — Migration

### A. The five re-padding outliers

Drop the self-padded wrapper (return a fragment → inherit shell padding +
`space-y-6`), swap the hand-rolled title for `PageHeader`, and wrap standalone
sections in `PageSection`:

- `app/(tenant)/tenant/activity/page.tsx`
- `app/(tenant)/tenant/members/page.tsx`
- `app/(tenant)/tenant/billing/page.tsx`
- `app/(admin)/admin/health/page.tsx`
- `app/(admin)/admin/firmware/page.tsx`

### B. Detail pages → extended `PageHeader`

- `app/(admin)/admin/customers/[tenantId]/page.tsx` — avatar → `leading`, status
  badge → `badge`, contact row → `description` node, back-link → `backHref`/
  `backLabel`. **Drop the `Card` wrapper** around the header so it matches the
  other detail pages.
- `app/(admin)/admin/devices/[deviceId]/page.tsx` — fold the standalone back-link
  into `backHref`/`backLabel`.
- `app/(tenant)/tenant/stores/[storeId]/page.tsx` — fold back-link into
  `backHref`/`backLabel`, move the `-mt-2` address line into `description`, and
  convert the "Printers in this store" `<h2>` to `SectionHeader`.

### C. Section headings

Replace remaining hand-rolled `<h2>` with `SectionHeader`: device/customer detail
"Remote control" and "Activity", health's three section headings, billing's
"Credit usage this month".

### D. Grid gaps

Light sweep: normalize any stray grid gaps to the convention (`gap-4` metric
grids, `gap-6` major splits). Most already comply.

### Pages needing no structural change

`admin` overview, `admin/customers`, `admin/devices`, `tenant`, `tenant/stores`,
`tenant/reports`, `tenant/analytics`, `tenant/branding`, `tenant/api`,
`tenant/device-settings` — already conform; touched only if they carry a stray
`<h2>` or grid gap.

## Verification

Pure presentational refactor — verification is build + visual, no unit tests
(the primitives have no logic branches worth asserting).

1. `npm run build` — typecheck passes (catches prop mismatches from the widened
   `PageHeader` signature).
2. Browse every changed dashboard page in both realms (`/admin`, `/tenant`) using
   the seed login (`admin@maratus.app` / `dana@roastwell.co`, both `123456`),
   before/after screenshots. Confirm: identical left/top margin on every page,
   uniform h1 size + weight, uniform section `<h2>`, no double-padding, no
   regression on detail-page headers.
3. Spot-check light and dark themes on two representative pages.

## Risks / notes

- All new `PageHeader` props are optional → the ~13 existing usages compile and
  render unchanged.
- Only intentional visible change: `admin/customers/[tenantId]` loses its
  `Card`-boxed header (for cross-detail-page consistency) and its status badge
  moves from inline-after-title to the `badge` slot (still adjacent to the title).
- No data-layer, route, or auth changes — `lib/data.ts`, server actions, and
  middleware are untouched.

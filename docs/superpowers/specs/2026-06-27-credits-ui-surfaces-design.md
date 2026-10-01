# Credits UI Surfaces — Design

**Date:** 2026-06-27
**Repo:** `maratus-admin`
**Status:** Approved design, pre-implementation
**Follows:** [credits + device-trigger core](2026-06-26-credits-and-device-trigger-core-design.md). Closes two deferred-Minor surfaces from that work.

## Problem

The credits feature ships with the data (an append-only `credit_ledger`; `settle` rows = realized spend) and the queries, but two reporting surfaces were left unwired:
- Admins can't see **which company spent how many credits** at a glance (`getCreditUsageAllOrgs` exists, no UI).
- Tenants can see their balance but not **which of their devices consumed the credits** (`getCreditUsageByDevice` exists, no UI; the API exposes it but there's no page).

## Goal

Two small, read-only, server-rendered panels reusing existing ledger queries + house chart/table patterns:
- **Admin "Credits by company"** on the admin dashboard.
- **Tenant "Credit usage this month"** on the billing page (next to balance + Buy-credits).

## Decisions (locked via brainstorming)

1. Tenant view lives on **`/tenant/billing`** (co-located with balance + Buy-credits), not the analytics page.
2. Admin panel lives on the **admin dashboard** (`app/(admin)/admin/page.tsx`).
3. Window = **current month** (`startOfMonth`, UTC), matching every other analytics surface. No date picker (YAGNI).
4. Spend = `credit_ledger` rows where `kind='settle'` (already the semantics of both query functions).

## Architecture

Both panels are server-rendered (both pages are React Server Components). Two small additions to the data layer fill the gaps the explore found (org-name join; device-name lookup); everything else reuses existing components.

### Data layer (`lib/data.ts`)

1. **Extend `getCreditUsageAllOrgs(since)`** — left-join `organization` for the name, sort by spend desc:
   ```ts
   // returns { organizationId, name, credits, count }[] ordered by credits desc
   db.select({
     organizationId: creditLedger.organizationId,
     name: orgTable.name,
     credits: sql<number>`sum(${creditLedger.credits})::int`,
     count: sql<number>`count(*)::int`,
   })
     .from(creditLedger)
     .leftJoin(orgTable, eq(orgTable.id, creditLedger.organizationId))
     .where(and(eq(creditLedger.kind, "settle"), gte(creditLedger.createdAt, since)))
     .groupBy(creditLedger.organizationId, orgTable.name)
     .orderBy(desc(sql`sum(${creditLedger.credits})`))
   ```
   Safe shape change: the function currently has **no callers** (it was implemented but unwired). `name` may be null for an orphaned org → render falls back to the id.

2. **New `deviceNamesForOrg(organizationId) → Promise<Map<string, string>>`** — batch lookup:
   ```ts
   const rows = await db.select({ id: device.id, name: device.name })
     .from(device).where(eq(device.organizationId, organizationId));
   return new Map(rows.map((r) => [r.id, r.name]));
   ```

No change to `getCreditUsageByDevice`, `getBalance`, `getCreditLedger`, or `rollupByDevice`.

### A) Admin "Credits by company" panel — `app/(admin)/admin/page.tsx`

- Fetch `getCreditUsageAllOrgs(startOfMonth())` (add to the page's existing `Promise.all`/data fetch).
- Render a new `Card` after the "Top customers" table, mirroring its structure:
  - Header: `CardTitle` "Credits by company", `CardDescription` "Trigger credits spent this month".
  - `Table` — columns **Company | Credits spent | Triggers** (right-aligned numerics, `tabular-nums`), rows = the top 10 by credits, `name ?? organizationId` for the label.
  - Empty state (`<TableRow>` single cell, muted) when the array is empty: "No credit usage yet this month."

### B) Tenant "Credit usage this month" — `app/(tenant)/tenant/billing/page.tsx`

- Fetch in the page (server component): `getCreditUsageByDevice(organizationId, startOfMonth())` and `deviceNamesForOrg(organizationId)`. (`getBalance` is already fetched for `BuyCreditsSection`.)
- Render a new `<section>` after `BuyCreditsSection`, matching the page's plain-section style (`<h2>` + content; the billing page does not use `Card`):
  - `<h2>` "Credit usage this month".
  - Balance line: "Available **N** · Held **M**" (held only shown when > 0).
  - A simple table (the billing page's invoices table is a plain `<table>` — match it): **Device | Credits | Triggers**, rows = `byDevice` sorted by credits desc, device label = `names.get(deviceId) ?? (deviceId === "unknown" ? "Unattributed" : deviceId)`. Total row or a "Total: {total}" line.
  - Empty state: "No credit usage this month." when `byDevice` is empty.

## Error handling

- Null org name → fall back to org id. Null/missing device name → show the id; `"unknown"` bucket → "Unattributed".
- Both panels are additive and independent: a failure to fetch one does not affect the rest of the page (the queries are simple selects; if the org has no balance/ledger the panels render their empty states).

## Testing

- This repo's suite is pure-function only (no DB harness). `rollupByDevice` (the one pure transform) is already tested.
- The two new queries + the two panels are verified by `npm run build` + `npx tsc --noEmit` and a **live check**: as platform admin the dashboard shows the "Credits by company" table; as a tenant the billing page shows "Credit usage this month" with device **names** (not ids). Seed via the existing admin grant + a `settle` (or reuse prod data) to confirm a non-empty render, and confirm empty states when there's no spend.

## Out of scope

- Date-range picker (fixed "this month").
- Charts (a Table is clearer here; `BreakdownBarChart` can be added later if desired).
- CSV export, per-action breakdown, historical trends.
- Any change to the credit state machine, Stripe, or firmware.

# Credits UI Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two read-only, server-rendered credits panels off the existing ledger queries — an admin "Credits by company" table on the dashboard and a tenant "Credit usage this month" (per-device, named) section on the billing page.

**Architecture:** Two small `lib/data.ts` additions (org-name join on `getCreditUsageAllOrgs`; a `deviceNamesForOrg` batch lookup; an exported `currentMonthStart()`), consumed by two existing server-component pages. Reuses house `Card`/`Table` patterns. Spend = `credit_ledger` rows with `kind='settle'`, current month (UTC).

**Tech Stack:** Next.js 16 App Router (RSC), Drizzle/Neon, Vitest (pure-only suite — UI/queries verified by build + live check).

## Global Constraints

- Window = **current month** (UTC), via a new exported `currentMonthStart(): Date`. No date picker.
- Spend = `kind='settle'` ledger rows (already enforced by the query functions).
- Both panels are **read-only**, server-rendered, additive; no change to the credit state machine, Stripe, or firmware.
- `getCreditUsageAllOrgs` shape change is safe — it currently has **no callers**.
- Device label: `names.get(deviceId) ?? (deviceId === "unknown" ? "Unattributed" : deviceId)`. Org label: `name ?? organizationId`.
- Build/type-check: `npm run build` / `npx tsc --noEmit`. Tests: `npm run test` (pure suite; the one pure transform `rollupByDevice` is already tested).
- Branch `feat/credits-ui-surfaces` (already created). Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- `lib/data.ts` — `currentMonthStart()` export; extend `getCreditUsageAllOrgs`; add `deviceNamesForOrg`. (Task 1)
- `app/(admin)/admin/page.tsx` — "Credits by company" Card. (Task 2)
- `app/(tenant)/tenant/billing/page.tsx` — "Credit usage this month" section. (Task 3)

---

## Task 1: Data layer — month-start helper, org-name join, device names

**Files:**
- Modify: `lib/data.ts`

**Interfaces:**
- Produces:
  - `currentMonthStart(): Date` — UTC first-of-month at 00:00.
  - `getCreditUsageAllOrgs(since: Date) → Promise<{ organizationId: string; name: string | null; credits: number; count: number }[]>` (ordered by credits desc).
  - `deviceNamesForOrg(organizationId: string) → Promise<Map<string, string>>`.

- [ ] **Step 1: Add `currentMonthStart()`**

In `lib/data.ts`, near the existing internal `startOfMonth()` (line ~222), add an exported helper returning a `Date`:
```ts
/** First instant of the current month, UTC — for analytics "this month" windows. */
export function currentMonthStart(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
}
```

- [ ] **Step 2: Extend `getCreditUsageAllOrgs` with the org-name join + ordering**

Replace the existing `getCreditUsageAllOrgs` (line ~1757) body with:
```ts
export async function getCreditUsageAllOrgs(since: Date) {
  return db
    .select({
      organizationId: creditLedgerTable.organizationId,
      name: orgTable.name,
      credits: sql<number>`sum(${creditLedgerTable.credits})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(creditLedgerTable)
    .leftJoin(orgTable, eq(orgTable.id, creditLedgerTable.organizationId))
    .where(and(eq(creditLedgerTable.kind, "settle"), gte(creditLedgerTable.createdAt, since)))
    .groupBy(creditLedgerTable.organizationId, orgTable.name)
    .orderBy(desc(sql`sum(${creditLedgerTable.credits})`));
}
```
(`orgTable`, `creditLedgerTable`, `and`/`eq`/`gte`/`desc`/`sql` are already imported in data.ts — confirm; add any missing.)

- [ ] **Step 3: Add `deviceNamesForOrg`**

Add near the other device queries:
```ts
/** Map of device id → name for an org, to label per-device credit usage. */
export async function deviceNamesForOrg(organizationId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: deviceTable.id, name: deviceTable.name })
    .from(deviceTable)
    .where(eq(deviceTable.organizationId, organizationId));
  return new Map(rows.map((r) => [r.id, r.name]));
}
```
(Use the existing device table alias in data.ts — it's imported as `device` or `deviceTable`; match the file's name.)

- [ ] **Step 4: Build + type-check**

Run: `npx tsc --noEmit` then `npm run build`
Expected: compiles clean (no callers of the old `getCreditUsageAllOrgs` shape break — there are none).

- [ ] **Step 5: (Optional) live sanity probe**

Create a throwaway `lib/db/_credits_ui_probe.ts`:
```ts
import "./load-env";
import { getCreditUsageAllOrgs, deviceNamesForOrg, currentMonthStart } from "../data";
async function main() {
  const all = await getCreditUsageAllOrgs(currentMonthStart());
  console.log("by-company (this month):", JSON.stringify(all.slice(0, 5)));
  if (all[0]) console.log("device names for top org:", [...(await deviceNamesForOrg(all[0].organizationId))].slice(0, 3));
  process.exit(0);
}
main();
```
Run `npx tsx lib/db/_credits_ui_probe.ts` (expect rows with `name` populated, ordered by credits desc), then `rm lib/db/_credits_ui_probe.ts`.

- [ ] **Step 6: Commit**
```bash
git add lib/data.ts
git commit -m "feat(credits): currentMonthStart + org-name join + deviceNamesForOrg

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Admin "Credits by company" panel

**Files:**
- Modify: `app/(admin)/admin/page.tsx`

**Interfaces:**
- Consumes: `getCreditUsageAllOrgs`, `currentMonthStart` (Task 1); existing `Card`/`Table`, `formatNumber`.

- [ ] **Step 1: Fetch the data**

In `app/(admin)/admin/page.tsx`, update the imports and the data fetch. Change line 23-27 region:
```ts
import { getAdminOverview, getCreditUsageAllOrgs, currentMonthStart } from "@/lib/data";
// ...
  const [o, creditsByOrg] = await Promise.all([
    getAdminOverview(),
    getCreditUsageAllOrgs(currentMonthStart()),
  ]);
```

- [ ] **Step 2: Render the Card after "Top customers"**

After the closing `</Card>` of the "Top customers" card (the `</Table>` is at line ~137; find the Card's closing tag), add a new `Card`:
```tsx
      <Card>
        <CardHeader>
          <CardTitle>Credits by company</CardTitle>
          <CardDescription>Trigger credits spent this month</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Company</TableHead>
                <TableHead className="text-right">Credits spent</TableHead>
                <TableHead className="text-right pr-6">Triggers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creditsByOrg.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="pl-6 text-muted-foreground">
                    No credit usage yet this month.
                  </TableCell>
                </TableRow>
              ) : (
                creditsByOrg.slice(0, 10).map((row) => (
                  <TableRow key={row.organizationId}>
                    <TableCell className="pl-6 font-medium">{row.name ?? row.organizationId}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(row.credits)}</TableCell>
                    <TableCell className="text-right pr-6 tabular-nums">{formatNumber(row.count)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
```
(Match the surrounding Card/Table class conventions on the page — e.g. if the "Top customers" Card uses `CardContent className="px-0"` or specific spacing, mirror it.)

- [ ] **Step 3: Build + live check**

Run: `npm run build` (clean). Manual: sign in as platform admin (`admin@maratus.app` / `123456`), open `/admin` — the "Credits by company" table renders (a row per org with settle spend this month, or the empty state). If prod has the earlier HIL settles, Roastwell appears.

- [ ] **Step 4: Commit**
```bash
git add "app/(admin)/admin/page.tsx"
git commit -m "feat(credits): admin Credits-by-company panel on the dashboard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Tenant "Credit usage this month" section

**Files:**
- Modify: `app/(tenant)/tenant/billing/page.tsx`

**Interfaces:**
- Consumes: `getCreditUsageByDevice`, `deviceNamesForOrg`, `currentMonthStart` (Task 1); existing `getBalance` (already fetched).

- [ ] **Step 1: Fetch usage + device names**

In `app/(tenant)/tenant/billing/page.tsx`, extend the imports and the `Promise.all`:
```ts
import { getTenantBilling, getCreditUsageByDevice, deviceNamesForOrg, currentMonthStart } from "@/lib/data";
// ...
  const [billing, balance, usage, deviceNames] = await Promise.all([
    getTenantBilling(organizationId),
    getBalance(organizationId),
    getCreditUsageByDevice(organizationId, currentMonthStart()),
    deviceNamesForOrg(organizationId),
  ]);
```

- [ ] **Step 2: Render the section after `BuyCreditsSection`**

Insert a new `<section>` between the `<BuyCreditsSection .../>` (line ~38) and the Invoices `<section>` (line ~40), matching the page's plain-section + plain-`<table>` style:
```tsx
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Credit usage this month</h2>
        <p className="text-sm text-muted-foreground">
          Available <span className="font-medium text-foreground tabular-nums">{balance.available}</span>
          {balance.held > 0 ? (
            <> · Held <span className="font-medium text-foreground tabular-nums">{balance.held}</span></>
          ) : null}
        </p>
        {usage.byDevice.length === 0 ? (
          <p className="text-sm text-muted-foreground">No credit usage this month.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Device</th>
                <th className="text-right">Credits</th>
                <th className="text-right">Triggers</th>
              </tr>
            </thead>
            <tbody>
              {usage.byDevice
                .slice()
                .sort((a, b) => b.credits - a.credits)
                .map((d) => (
                  <tr key={d.deviceId} className="border-t">
                    <td className="py-2">
                      {deviceNames.get(d.deviceId) ?? (d.deviceId === "unknown" ? "Unattributed" : d.deviceId)}
                    </td>
                    <td className="text-right tabular-nums">{d.credits}</td>
                    <td className="text-right tabular-nums">{d.count}</td>
                  </tr>
                ))}
              <tr className="border-t font-medium">
                <td className="py-2">Total</td>
                <td className="text-right tabular-nums">{usage.total}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        )}
      </section>
```

- [ ] **Step 3: Build + live check**

Run: `npm run build` (clean). Manual: sign in as `dana@roastwell.co` / `123456`, open `/tenant/billing` — the "Credit usage this month" section shows per-device rows with device **names** (or "Unattributed" for the unknown bucket), plus the Total; empty state when there's no spend this month.

- [ ] **Step 4: Commit**
```bash
git add "app/(tenant)/tenant/billing/page.tsx"
git commit -m "feat(credits): tenant Credit-usage-this-month section on billing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review notes

- **Spec coverage:** org-name join + ordering (T1/T2); device-name resolution (T1/T3); admin by-company table (T2); tenant per-device usage + balance (T3); this-month window via `currentMonthStart` (T1); empty states (T2/T3); read-only/server-rendered throughout.
- **Type consistency:** `getCreditUsageAllOrgs → {organizationId,name,credits,count}[]`, `deviceNamesForOrg → Map<string,string>`, `currentMonthStart(): Date`, `getCreditUsageByDevice → {total, byDevice:[{deviceId,credits,count}]}` used consistently.
- **No-DB-test-harness reality:** queries/pages verified by build + live check; the optional probe (T1 step 5) confirms the join shape against the dev DB.

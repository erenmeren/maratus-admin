# Phase 2C — Audit-Log UI Polish — Design

**Date:** 2026-06-28
**Repo:** `maratus-admin`
**Status:** Approved design, pre-implementation
**Phase:** 2 ("feature expansion"), sub-project **2C** (last). Builds on 2A/2B (both merged). **Completes Phase 2.**

## Problem

The audit pipeline is complete (`auditLog` table + `recordAudit` + 37 `AUDIT.*` constants + `getOrgAuditLog`), but both UI surfaces are crude:
- **Raw dotted action strings** are shown verbatim (`device.went_offline`, `invoice.sent`) on the tenant Activity page and the admin customer-detail audit section.
- **No `target`** is rendered (the field exists but isn't shown).
- **No pagination** — the tenant page dumps the most-recent 100; there is no way past the ceiling.
- Inconsistent markup (bare `<table>` / `<ul>`), naive `at.slice(0,19)` timestamps instead of `timeAgo`.

2C makes the audit log readable and paginable. **No filter bar and no `metadata` rendering** (deferred — see Out of scope).

## Decisions (locked via brainstorming)

1. **Human-readable labels** via a pure map of all 37 actions + a humanizer fallback for any unmapped/future action.
2. **Offset/page-number pagination** on the tenant Activity page (mirrors the documents `?page=N` pattern), **page size 25**. The admin section stays a recent-50 summary (no pagination — it's a sidebar).
3. **Show `target`**; **do NOT surface `metadata`** (the JSON blob) in this tier.
4. **Actor-type badge** — a small muted chip for `system`/`stripe` actors (`user` shows the label plainly).
5. Render both surfaces with consistent, existing primitives (shadcn `Table` on the tenant page; the admin `<ul>` section keeps its shape but gains labels/target/timeAgo).

## Architecture

### A) Pure labels — `lib/audit-labels.ts` (new, IO-free)

```ts
export const AUDIT_LABELS: Record<string, string>;   // all 37 AUDIT.* values → friendly label
export function humanizeAction(action: string): string;  // fallback: "device.command_enqueued" → "Device: Command enqueued"
export function actionLabel(action: string): string;     // AUDIT_LABELS[action] ?? humanizeAction(action)
```

- `AUDIT_LABELS` covers every value in `AUDIT` (`lib/audit.ts`) — e.g. `"device.went_offline"` → `"Device went offline"`, `"invoice.payment_failed"` → `"Payment failed"`, `"member.role_changed"` → `"Member role changed"`, `"credits.purchased"` → `"Credits purchased"`.
- `humanizeAction`: split on `.`; for each segment replace `_` with spaces and title-case; join entity + verb as `"Entity: Verb words"`. Guarantees a sane label for any future action string without a map update.
- Pure → unit-tested (representative map hits + the fallback on an unmapped string).

### B) Data layer — `lib/data.ts`

- **Extend `getOrgAuditLog`'s row** with `actorType: "user" | "system" | "stripe"` (the column already exists; just project it). Non-breaking — existing callers read named fields. Used by the actor badge on both surfaces.
- **Add `getOrgAuditPage`** (new):
  ```ts
  export async function getOrgAuditPage(
    organizationId: string,
    page: number,        // 1-based; clamp to >= 1
    pageSize?: number,   // default 25
  ): Promise<{
    rows: { id: string; action: string; actorType: string; actor: string; target: string | null; metadata: Record<string, unknown> | null; at: string }[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;   // max(1, ceil(total / pageSize))
  }>;
  ```
  One `count(*)` over the org's audit rows + a `LIMIT pageSize OFFSET (page-1)*pageSize` select ordered `desc(createdAt)`. Mirrors the documents offset pattern (`lib/documents-search.ts`).

### C) Tenant Activity page — `app/(tenant)/tenant/activity/page.tsx`

- Read `?page=N` from `searchParams` (parse + clamp to ≥1); call `getOrgAuditPage(organizationId, page)`.
- Render with the shadcn `Table` (`components/ui/table.tsx`) — columns **When** / **Action** / **Actor** / **Target**:
  - When: `timeAgo(e.at)`.
  - Action: `actionLabel(e.action)`.
  - Actor: `e.actor` + a small muted chip when `e.actorType !== "user"` (e.g. "system"/"stripe").
  - Target: `e.target` (the `type:id` string) shown muted/mono, or "—" when null.
- **Prev/Next** pagination via `<Link href="?page=N">` (mirroring `components/documents/documents-table.tsx`), disabled/hidden at the ends; show "Page X of pageCount".
- Stays a server component (no client JS needed — links carry `?page`).

### D) Admin customer-detail audit section — `app/(admin)/admin/customers/[tenantId]/page.tsx`

- Keep the recent-50 `<ul>` summary, but: render `actionLabel(e.action)` instead of the raw string, append the **target** when present, and use `timeAgo(e.at)` for the timestamp. (Optional small actor-type chip for parity — same component/util as the tenant page.)

## Data flow

```
/tenant/activity?page=N → getOrgAuditPage(orgId, N, 25) → { rows, total, pageCount }
  → shadcn Table: When(timeAgo) | Action(actionLabel) | Actor(+type chip) | Target
  → Prev/Next ?page links

/admin/customers/[id] → getOrgAuditLog(orgId, 50) [now incl. actorType]
  → <ul>: actionLabel + target + timeAgo
```

## Error handling / edge cases

- **Unmapped action** → `humanizeAction` fallback (never shows a raw dotted string).
- **page out of range:** clamp `page` to ≥1; if `page > pageCount`, the offset returns an empty page — render an empty-state row and a "Page X of pageCount" that lets the user go back (Prev). (Mirror the documents behavior; no crash.)
- **Empty audit log:** `total = 0`, `pageCount = 1`, empty-state row.
- **null target** → "—".
- **`metadata`** is selected by the paged fn (shape parity) but intentionally NOT rendered.

## Testing

- **Pure unit tests** (`lib/audit-labels.test.ts`): `actionLabel` returns the mapped label for several known actions (incl. `device.went_offline`, `invoice.sent`, `credits.purchased`); `humanizeAction` on an unmapped string (e.g. `"foo.bar_baz"` → `"Foo: Bar baz"`); `actionLabel` falls back to `humanizeAction` for an unknown action. A guard test asserting every value in `AUDIT` (imported from `lib/audit.ts`) has an entry in `AUDIT_LABELS` (so the map can't silently drift from the constants).
- **Existing suite green** (`npm run test`, 300 → grows) + `npm run build` + `npx tsc --noEmit`.
- **Manual (deferred):** `/tenant/activity` shows friendly labels + target + Prev/Next; `/tenant/activity?page=2` paginates; the admin customer detail shows friendly labels + target.

## Out of scope (deferred — fast-follow if wanted)

- **Filter bar** (by action category / date / actor).
- **`metadata` rendering** (the JSON blob; e.g. amounts on invoice events, roles on member events).
- Pagination on the admin customer-detail section (stays a recent-50 summary).
- A platform-wide cross-tenant audit search.

**Phase 2 completes with 2C:** 2A device fleet ops ✅, 2B tenant health ✅, 2C audit-log UI (this).

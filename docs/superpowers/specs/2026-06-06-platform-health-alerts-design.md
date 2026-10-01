# Platform Health Alerts (Spec B) — Design

_Date: 2026-06-06_

## Context

`/admin/health` (platform admin) computes operational alerts **live** on each page
load: `getPlatformHealth()` gathers fleet/ingest/tenant metrics and calls the pure
`computeAlerts()` (`lib/health.ts`) → `HealthAlert[]` rendered by `AlertsBanner`
(Spec A, shipped). What's missing (the deferred **Spec B**):

1. **Persistence** — no alert history; alerts vanish when you leave the page.
2. **Scheduled evaluation** — alerts only exist while someone is looking.
3. **Email-on-trip** — no notification when something breaks.

This closes Spec B, completing Phase 2.

### Decisions (locked during brainstorming)

- **Persisted `alert` table** with an open/resolved lifecycle.
- **Hourly** Vercel cron evaluator.
- **Email all platform admins** (`user.role = 'platform_admin'`) on a fresh trip.
- **Alert history** section added to `/admin/health` (the live banner stays).
- Reuse the existing pieces: pure `computeAlerts`, the non-throwing `sendEmail`
  (`lib/email.ts`), `CRON_SECRET` (already set in Vercel prod), the `auditLog`
  table as a schema template, migrations in `./drizzle` (next is `0008`).

## Guiding principles

- **Pure, testable lifecycle.** The open/resolve diff and the email composition are
  IO-free in `lib/alerts.ts` (unit-tested); IO lives in `lib/alerts-sync.ts` — the
  codebase's "pure mappers + IO" split (cf. `billing-status.ts` + `stripe-billing.ts`).
- **DRY metrics.** Extract the metric computation `getPlatformHealth` already does
  into a shared `getAlertInputs()` so the page and the evaluator can't diverge.
- **Best-effort notification.** A failed email (Resend 403 in test mode, outage)
  must never fail the evaluation — `sendEmail` already never throws.
- **Idempotent ticks.** Running the evaluator repeatedly only emails on a
  closed→open transition, never re-emails an already-open alert.

---

## Data model — new `alert` table (migration `0008`)

Platform-level (no org FK; tenant-scoped alerts carry the org id inside `key`):

```ts
export const alert = pgTable(
  "alert",
  {
    id: text("id").primaryKey(),
    // Stable identity from computeAlerts: "devices-stale", "receipts-stuck",
    // "tenants-inactive", "tenant-inactive:<orgId>".
    key: text("key").notNull(),
    severity: text("severity", { enum: ["info", "warning"] }).notNull(),
    message: text("message").notNull(),
    status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
    firstSeenAt: timestamp("first_seen_at").$defaultFn(() => new Date()).notNull(),
    lastSeenAt: timestamp("last_seen_at").$defaultFn(() => new Date()).notNull(),
    resolvedAt: timestamp("resolved_at"),
    notifiedAt: timestamp("notified_at"),
  },
  (t) => [
    // At most ONE open row per key. A key may re-open after resolving (new row).
    uniqueIndex("alert_open_key_idx").on(t.key).where(sql`status = 'open'`),
    index("alert_status_idx").on(t.status, t.lastSeenAt),
  ],
);
```

Add `alert` to the `schema` export map in `lib/db/schema.ts`. Generate the
migration with `npm run db:generate` (creates `drizzle/0008_*.sql`); apply with
`npm run db:migrate`.

---

## Pure core — new `lib/alerts.ts` (IO-free, unit-tested)

```ts
import type { HealthAlert } from "./health";

export interface OpenAlert { key: string; message: string }

export interface AlertDiff {
  toOpen: HealthAlert[];                 // tripped now, not currently open
  toResolve: OpenAlert[];                // open in DB, no longer tripped
  stillOpen: { key: string; message: string }[]; // persist; refresh message/lastSeen
}

/** Reconcile freshly-computed alerts against the currently-open persisted rows. */
export function diffAlerts(current: HealthAlert[], open: OpenAlert[]): AlertDiff;

/** Digest email for newly-opened alerts. null when there are none. */
export function alertEmail(newAlerts: HealthAlert[]): { subject: string; html: string } | null;
```

- `diffAlerts`: `toOpen` = current keys not in `open`; `toResolve` = open keys not in
  current; `stillOpen` = intersection (carry the current message so a changed count
  updates). Keyed by `key`.
- `alertEmail`: `null` if empty; else subject like `"⚠ Maratus: N new health alert(s)"`
  and an HTML list of `severity` + `message`.

---

## Evaluation IO — new `lib/alerts-sync.ts`

```ts
export async function evaluateAndPersistAlerts(): Promise<{
  opened: number; resolved: number; stillOpen: number;
}>;
```

Steps:
1. `const inputs = await getAlertInputs();` (shared with `getPlatformHealth`).
2. `const current = computeAlerts(inputs);`
3. Load open rows: `select … from alert where status='open'`.
4. `const diff = diffAlerts(current, open);`
5. Apply (in the `alert` table): insert `toOpen` (status open, first/lastSeen=now);
   update `stillOpen` (lastSeenAt=now, message); resolve `toResolve`
   (status='resolved', resolvedAt=now).
6. If `diff.toOpen.length`: `const mail = alertEmail(diff.toOpen)`; fetch recipients
   (`select email from "user" where role='platform_admin'`); `await sendEmail(to, …)`
   for each (best-effort); stamp `notifiedAt=now` on the just-opened rows.
7. Return `{ opened, resolved, stillOpen }`.

**`getAlertInputs()` in `lib/data.ts`:** a standalone, lean function returning
`{ staleCount: number; stuckPendingCount: number; inactiveTenants: { id: string;
name: string }[] }` for the cron path. It mirrors `getPlatformHealth`'s predicates,
but `getPlatformHealth` is left **unchanged** — it needs richer display data
(stale device rows, inactive tenants *with* `lastReceiptAt`), so having it call
`getAlertInputs` would double-query or drop data. The real single source of truth
for alert *rules* is the shared pure `computeAlerts` + thresholds in `lib/health.ts`,
which both paths use — so the two query paths can't produce different alerts. The
only duplication is three small count/list queries (accepted tradeoff).

---

## Cron endpoint — `app/api/cron/health/route.ts` + `vercel.json`

```ts
export const runtime = "nodejs";
export async function GET(req: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await evaluateAndPersistAlerts();
  return Response.json({ ok: true, ...summary });
}
```

- `lib/env.ts`: add `CRON_SECRET: z.string().optional()` and document in `.env.example`.
- `vercel.json` (new): `{ "crons": [{ "path": "/api/cron/health", "schedule": "0 * * * *" }] }`.
  Vercel automatically sends `Authorization: Bearer ${CRON_SECRET}` to cron paths when
  the env var is set.

> ⚠️ **Vercel tier caveat:** the Hobby plan restricts cron frequency (effectively
> daily). **Hourly requires Pro.** If the project is on Hobby the hourly schedule
> won't fire as written — the endpoint still works on demand and via any external
> scheduler hitting it with the bearer secret. Documented, not blocking.

---

## In-app history — `/admin/health`

Keep the live `AlertsBanner` (instant snapshot). Add an **"Alert history"** card below it:

- New data fn `getAlertHistory(): Promise<{ open: AlertRow[]; resolved: AlertRow[] }>`
  — `open` ordered by `firstSeenAt` desc; `resolved` where `resolvedAt >= now-7d`,
  desc, limited (e.g. 25). `AlertRow = { id, key, severity, message, firstSeenAt,
  resolvedAt, notifiedAt }` (ISO strings for the client).
- New component `components/health/alert-history.tsx` — two small lists: open (with
  "open for Xh", a "notified" check if `notifiedAt`) and recently resolved (with
  resolved time). Reuses the banner's severity styling.

---

## Testing

`lib/alerts.test.ts` (vitest):
- `diffAlerts`: new key → `toOpen`; open key gone from current → `toResolve`;
  key in both → `stillOpen` with the current (possibly updated) message; current
  empty + open present → all resolve; both empty → all empty arrays.
- `alertEmail`: `null` for `[]`; non-empty returns a subject mentioning the count
  and HTML containing each alert message.

IO (`evaluateAndPersistAlerts`, `getAlertInputs`, `getAlertHistory`, the cron route)
follows the codebase convention of not being unit-tested; verified by `npm run build`
plus a manual `curl -H "Authorization: Bearer <CRON_SECRET>"` against the endpoint
on a running dev server (asserting the JSON summary and that rows appear in the
`alert` table).

## Out of scope

- Per-tenant alert subscriptions; Slack/webhook channels.
- A thresholds-configuration UI (thresholds stay constants in `lib/health.ts`).
- Alert acknowledgement / snooze workflow.
- New alert *rules* beyond the three `computeAlerts` already produces.

## Follow-ups

- When a domain is verified, alert emails reach all admins (today, Resend test mode
  only delivers to `erenaltan@gmail.com`). See [[external-accounts-status]].
- If on Vercel Hobby, upgrade to Pro (or wire an external scheduler) for the hourly tick.

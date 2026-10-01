# Phase 2B — Tenant Health Drill-down + Alert Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins per-tenant health (traffic-light in the customers list + a health card on the detail page, with the effective-status fix) and notify a tenant's owner when their device goes offline.

**Architecture:** A pure `tenantHealthLevel` rule; health fields folded into the existing `summarize`/`getCustomerDetail` (reusing already-loaded device + subscription data, applying `effectiveDeviceStatus`); and a pure `deviceOfflineEmail` builder triggered once-per-org-per-sweep inside 2A's `reconcileOfflineDevices`.

**Tech Stack:** Next.js 16 RSC, Drizzle/Neon, Vitest (pure helpers). Reuses 2A `effectiveDeviceStatus`/`reconcileOfflineDevices` and 1C `getOrgEmailContext`/`sendEmail`/`emailLayout`.

## Global Constraints

- **Health levels:** critical = `isSuspended(subscriptionStatus)` OR (deviceCount>0 AND onlineCount===0); warning = offlineCount>0 OR stuckPending>0 OR `past_due` OR inactive (>`INACTIVE_DAYS`); else healthy.
- **Offline email batched one-per-org-per-sweep** (group flipped devices by org; one owner email listing them).
- **No `alert` table schema change.** Per-tenant health computed from device/document rows.
- **`mapDevice` stays raw** (global behavior unchanged); the effective-status fix is applied LOCALLY in `getCustomerDetail` and the online/offline counts in `summarize`.
- **`sendEmail` never throws / no-ops without `RESEND_API_KEY`** — the cron is never broken. Platform-admin digest unchanged.
- Reuse the exported `emailLayout`/`escapeHtml` from `lib/billing/invoice-emails.ts`.
- Verification per task: `npm run test` (currently 286, stays green), `npm run build`, `npx tsc --noEmit`. Dev server on **:3001**.

## File Map

| File | Responsibility | Task |
|---|---|---|
| `lib/tenant-health.ts` (new) + `.test.ts` | pure `tenantHealthLevel` + `HealthLevel` | 1 |
| `lib/types.ts` (modify) + `lib/data.ts` `summarize` (modify) | `TenantSummary` health fields | 2 |
| `app/(admin)/admin/customers/page.tsx` (modify) | Health column | 2 |
| `lib/data.ts` `getCustomerDetail` + `CustomerDetail` (modify) | effective devices + health field | 3 |
| `app/(admin)/admin/customers/[tenantId]/page.tsx` (modify) | health summary card | 3 |
| `lib/devices/device-emails.ts` (new) + `.test.ts` | pure `deviceOfflineEmail` | 4 |
| `lib/alerts-sync.ts` `reconcileOfflineDevices` (modify) | per-org offline email | 5 |

---

### Task 1: Pure tenant health level

**Files:**
- Create: `lib/tenant-health.ts`
- Test: `lib/tenant-health.test.ts`

**Interfaces:**
- Consumes: `isSuspended` (`lib/billing/billing-status.ts`), `INACTIVE_DAYS` (`lib/health.ts`).
- Produces:
  - `type HealthLevel = "healthy" | "warning" | "critical"`
  - `interface TenantHealthInput { deviceCount: number; onlineCount: number; offlineCount: number; subscriptionStatus: string | null; stuckPendingCount?: number; lastActivityAt?: Date | null }`
  - `tenantHealthLevel(input: TenantHealthInput, now: Date): HealthLevel`

- [ ] **Step 1: Write the failing test**

Create `lib/tenant-health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tenantHealthLevel, type TenantHealthInput } from "./tenant-health";
import { INACTIVE_DAYS } from "./health";

const now = new Date("2026-06-28T12:00:00Z");
const base: TenantHealthInput = {
  deviceCount: 3,
  onlineCount: 3,
  offlineCount: 0,
  subscriptionStatus: "active",
};

describe("tenantHealthLevel", () => {
  it("healthy when all online and subscription active", () => {
    expect(tenantHealthLevel(base, now)).toBe("healthy");
  });
  it("critical when subscription is suspended (canceled)", () => {
    expect(tenantHealthLevel({ ...base, subscriptionStatus: "canceled" }, now)).toBe("critical");
  });
  it("critical when there are devices but none online", () => {
    expect(tenantHealthLevel({ ...base, onlineCount: 0, offlineCount: 3 }, now)).toBe("critical");
  });
  it("warning when some (but not all) devices are offline", () => {
    expect(tenantHealthLevel({ ...base, onlineCount: 2, offlineCount: 1 }, now)).toBe("warning");
  });
  it("warning on stuck-pending documents", () => {
    expect(tenantHealthLevel({ ...base, stuckPendingCount: 2 }, now)).toBe("warning");
  });
  it("warning when subscription is past_due", () => {
    expect(tenantHealthLevel({ ...base, subscriptionStatus: "past_due" }, now)).toBe("warning");
  });
  it("warning when inactive beyond INACTIVE_DAYS", () => {
    const old = new Date(now.getTime() - (INACTIVE_DAYS + 1) * 86_400_000);
    expect(tenantHealthLevel({ ...base, lastActivityAt: old }, now)).toBe("warning");
  });
  it("critical takes precedence over warning", () => {
    expect(
      tenantHealthLevel({ ...base, subscriptionStatus: "canceled", offlineCount: 1, onlineCount: 2 }, now),
    ).toBe("critical");
  });
  it("an empty fleet (0 devices) is not critical for the zero-online reason", () => {
    expect(tenantHealthLevel({ ...base, deviceCount: 0, onlineCount: 0, offlineCount: 0 }, now)).toBe("healthy");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tenant-health.test.ts`
Expected: FAIL — `Cannot find module './tenant-health'`.

- [ ] **Step 3: Write the implementation**

Create `lib/tenant-health.ts`:

```ts
// lib/tenant-health.ts
// Pure per-tenant health rollup → traffic-light level. No IO. The IO that gathers
// the inputs lives in lib/data.ts (summarize / getCustomerDetail).
import { isSuspended } from "./billing/billing-status";
import { INACTIVE_DAYS } from "./health";

export type HealthLevel = "healthy" | "warning" | "critical";

export interface TenantHealthInput {
  deviceCount: number;
  onlineCount: number;
  offlineCount: number;
  subscriptionStatus: string | null;
  stuckPendingCount?: number;   // omitted on the cheap (list) path → treated as 0
  lastActivityAt?: Date | null;  // omitted on the list path → inactivity not escalated
}

export function tenantHealthLevel(input: TenantHealthInput, now: Date): HealthLevel {
  // critical: service blocked, or the fleet can't print at all.
  if (isSuspended(input.subscriptionStatus)) return "critical";
  if (input.deviceCount > 0 && input.onlineCount === 0) return "critical";

  // warning: degraded but operational.
  if (input.offlineCount > 0) return "warning";
  if ((input.stuckPendingCount ?? 0) > 0) return "warning";
  if (input.subscriptionStatus === "past_due") return "warning";
  if (
    input.lastActivityAt != null &&
    now.getTime() - input.lastActivityAt.getTime() > INACTIVE_DAYS * 86_400_000
  ) {
    return "warning";
  }

  return "healthy";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/tenant-health.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm run test && npx tsc --noEmit`
Expected: all green (286 + new), no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/tenant-health.ts lib/tenant-health.test.ts
git commit -m "feat(health): pure tenantHealthLevel rollup (2B)"
```

---

### Task 2: Customers-list health column

**Files:**
- Modify: `lib/types.ts` (`TenantSummary`)
- Modify: `lib/data.ts` (`summarize`)
- Modify: `app/(admin)/admin/customers/page.tsx`

**Interfaces:**
- Consumes: `tenantHealthLevel` + `HealthLevel` (Task 1); `effectiveDeviceStatus` (`lib/device-status.ts`); `OrgBundle.settings.subscriptionStatus`.
- Produces: `TenantSummary` gains `onlineCount: number`, `offlineCount: number`, `health: HealthLevel`.

- [ ] **Step 1: Extend the `TenantSummary` type**

In `lib/types.ts`, add an import + three fields. At the top add:

```ts
import type { HealthLevel } from "./tenant-health";
```

In `interface TenantSummary { ... }` add after `deviceCount: number;`:

```ts
  onlineCount: number;
  offlineCount: number;
  health: HealthLevel;
```

- [ ] **Step 2: Compute the health fields in `summarize`**

In `lib/data.ts`, ensure these imports exist (add if missing): `effectiveDeviceStatus` from `./device-status` and `tenantHealthLevel` from `./tenant-health`. Then update `summarize` to compute the counts + level (the devices and settings are already loaded in the bundle):

```ts
function summarize(b: OrgBundle): TenantSummary {
  const tenant = buildTenant(b);
  const allDevices = tenant.stores.flatMap((s) => s.devices);
  const documentsThisMonth = allDevices.reduce(
    (a, d) => a + d.documentsThisMonth,
    0,
  );
  const now = new Date();
  let onlineCount = 0;
  let offlineCount = 0;
  for (const d of allDevices) {
    const eff = effectiveDeviceStatus(d.status, d.lastSeenAt ? new Date(d.lastSeenAt) : null, now);
    if (eff === "online") onlineCount++;
    else if (eff === "offline") offlineCount++;
  }
  const health = tenantHealthLevel(
    {
      deviceCount: allDevices.length,
      onlineCount,
      offlineCount,
      subscriptionStatus: b.settings?.subscriptionStatus ?? null,
    },
    now,
  );
  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    storeCount: tenant.stores.length,
    deviceCount: allDevices.length,
    onlineCount,
    offlineCount,
    documentsThisMonth,
    revenueThisMonth:
      Math.round(documentsThisMonth * tenant.perPrintPrice * 100) / 100,
    perPrintPrice: tenant.perPrintPrice,
    health,
  };
}
```

- [ ] **Step 3: Render the Health column in the customers page**

In `app/(admin)/admin/customers/page.tsx`, add a `Health` header after the `Devices` head:

```tsx
              <TableHead className="text-center">Devices</TableHead>
              <TableHead className="text-center">Health</TableHead>
              <TableHead className="text-right">Documents (mo.)</TableHead>
```

And a matching cell after the Devices cell. Add this helper above the component (module scope) for the dot color + label:

```tsx
const HEALTH_UI: Record<"healthy" | "warning" | "critical", { dot: string; label: string }> = {
  healthy: { dot: "bg-emerald-500", label: "Healthy" },
  warning: { dot: "bg-amber-500", label: "Warning" },
  critical: { dot: "bg-red-500", label: "Critical" },
};
```

Then the cell:

```tsx
                <TableCell className="text-center tabular-nums">
                  {c.deviceCount}
                </TableCell>
                <TableCell className="text-center">
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span className={`size-2 rounded-full ${HEALTH_UI[c.health].dot}`} />
                    {HEALTH_UI[c.health].label}
                    <span className="text-muted-foreground">({c.onlineCount}/{c.deviceCount})</span>
                  </span>
                </TableCell>
```

- [ ] **Step 4: Typecheck + build + suite**

Run: `npx tsc --noEmit && npm run build && npm run test`
Expected: no type errors (every `TenantSummary` literal now needs the 3 new fields — `summarize` is the only constructor; confirm with grep `TenantSummary` that no other code builds one); build OK; 286+ green.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/data.ts "app/(admin)/admin/customers/page.tsx"
git commit -m "feat(health): tenant health traffic-light in the admin customers list (2B)"
```

---

### Task 3: Customer-detail health card + effective-status fix

**Files:**
- Modify: `lib/data.ts` (`getCustomerDetail`, `CustomerDetail`)
- Modify: `app/(admin)/admin/customers/[tenantId]/page.tsx`

**Interfaces:**
- Consumes: `tenantHealthLevel`/`HealthLevel` (Task 1); `effectiveDeviceStatus`; `STUCK_PENDING_MINUTES` (`lib/health.ts`); `document` table.
- Produces: `CustomerDetail` gains `health: { level: HealthLevel; online: number; offline: number; paused: number; stuckPendingCount: number; subscriptionStatus: string | null }`; its `devices` now carry effective status.

- [ ] **Step 1: Compute effective devices + health in `getCustomerDetail`**

In `lib/data.ts`, ensure imports: `effectiveDeviceStatus` (`./device-status`), `tenantHealthLevel`, `HealthLevel` type (`./tenant-health`), `STUCK_PENDING_MINUTES` (`./health`), and from `drizzle-orm` `and`/`eq`/`lt`/`sql`/`max` (most already imported — add `max` if missing). Replace the `getCustomerDetail` body's device build + return with:

```ts
export async function getCustomerDetail(
  organizationId: string,
): Promise<CustomerDetail | null> {
  const b = await loadOrg(organizationId);
  if (!b) return null;
  const tenant = buildTenant(b);
  const summary = summarize(b);
  const now = new Date();

  // Apply effective status locally (mapDevice stays raw globally).
  const devices: DeviceRow[] = tenant.stores.flatMap((store) =>
    store.devices.map((d) => ({
      ...d,
      status: effectiveDeviceStatus(d.status, d.lastSeenAt ? new Date(d.lastSeenAt) : null, now),
      tenantName: tenant.name,
      storeName: store.name,
    })),
  );
  let online = 0, offline = 0, paused = 0;
  for (const d of devices) {
    if (d.status === "online") online++;
    else if (d.status === "offline") offline++;
    else if (d.status === "paused") paused++;
  }

  const stuckCutoff = new Date(now.getTime() - STUCK_PENDING_MINUTES * 60_000);
  const [{ stuck }] = await db
    .select({ stuck: sql<number>`count(*)::int` })
    .from(documentTable)
    .where(
      and(
        eq(documentTable.organizationId, organizationId),
        eq(documentTable.status, "pending"),
        lt(documentTable.createdAt, stuckCutoff),
      ),
    );
  const [{ last }] = await db
    .select({ last: max(documentTable.createdAt) })
    .from(documentTable)
    .where(eq(documentTable.organizationId, organizationId));

  const subscriptionStatus = b.settings?.subscriptionStatus ?? null;
  const level = tenantHealthLevel(
    {
      deviceCount: devices.length,
      onlineCount: online,
      offlineCount: offline,
      subscriptionStatus,
      stuckPendingCount: stuck,
      lastActivityAt: last ?? null,
    },
    now,
  );

  return {
    tenant,
    summary,
    devices,
    health: { level, online, offline, paused, stuckPendingCount: stuck, subscriptionStatus },
    monthly: monthlySeries(b, tenant.perPrintPrice),
    invoices: await getInvoices(organizationId),
    eco: computeEcoSavings(summary.documentsThisMonth),
  };
}
```

(`documentTable` is the existing alias for the `document` table import in `lib/data.ts` — use whatever name that file already imports it as.)

- [ ] **Step 2: Add `health` to the `CustomerDetail` interface**

In `lib/data.ts` (the `CustomerDetail` interface), add after `devices: DeviceRow[];`:

```ts
  health: {
    level: HealthLevel;
    online: number;
    offline: number;
    paused: number;
    stuckPendingCount: number;
    subscriptionStatus: string | null;
  };
```

(Add `import type { HealthLevel } from "./tenant-health";` if not already imported for Task-3 use.)

- [ ] **Step 3: Render the health card on the detail page**

In `app/(admin)/admin/customers/[tenantId]/page.tsx`, destructure `health` and render a card. Update the destructure line:

```tsx
  const { tenant, summary, devices, monthly, health } = detail;
```

Add a module-scope helper (top of file) for the level styling:

```tsx
const HEALTH_UI: Record<"healthy" | "warning" | "critical", { dot: string; label: string }> = {
  healthy: { dot: "bg-emerald-500", label: "Healthy" },
  warning: { dot: "bg-amber-500", label: "Warning" },
  critical: { dot: "bg-red-500", label: "Critical" },
};
```

Insert the health card immediately AFTER the header card's closing `</Card>` (before the KPI/section content). Use the existing `Card`/`CardContent` primitives:

```tsx
      {/* Health summary */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 p-5 text-sm">
          <span className="inline-flex items-center gap-2 font-medium">
            <span className={`size-2.5 rounded-full ${HEALTH_UI[health.level].dot}`} />
            {HEALTH_UI[health.level].label}
          </span>
          <span className="text-muted-foreground">Online <strong className="text-foreground">{health.online}</strong></span>
          <span className="text-muted-foreground">Offline <strong className="text-foreground">{health.offline}</strong></span>
          <span className="text-muted-foreground">Paused <strong className="text-foreground">{health.paused}</strong></span>
          <span className="text-muted-foreground">Stuck docs <strong className="text-foreground">{health.stuckPendingCount}</strong></span>
          <span className="text-muted-foreground">Subscription <strong className="text-foreground">{health.subscriptionStatus ?? "none"}</strong></span>
        </CardContent>
      </Card>
```

- [ ] **Step 4: Typecheck + build + suite**

Run: `npx tsc --noEmit && npm run build && npm run test`
Expected: no type errors; build OK; 286+ green. (The device table on this page now reflects effective status automatically — no separate edit needed.)

- [ ] **Step 5: Commit**

```bash
git add lib/data.ts "app/(admin)/admin/customers/[tenantId]/page.tsx"
git commit -m "feat(health): customer-detail health card + effective device status fix (2B)"
```

---

### Task 4: Pure device-offline email builder

**Files:**
- Create: `lib/devices/device-emails.ts`
- Test: `lib/devices/device-emails.test.ts`

**Interfaces:**
- Consumes: `emailLayout`, `escapeHtml` from `lib/billing/invoice-emails.ts` (already exported).
- Produces: `deviceOfflineEmail(input: { orgName: string; devices: { name: string; storeName: string; lastSeenLabel: string }[] }): { subject: string; html: string }`.

- [ ] **Step 1: Write the failing test**

Create `lib/devices/device-emails.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deviceOfflineEmail } from "./device-emails";

const one = {
  orgName: "Roastwell Coffee",
  devices: [{ name: "Front Counter", storeName: "Downtown", lastSeenLabel: "2026-06-28 11:40 UTC" }],
};

describe("deviceOfflineEmail", () => {
  it("singular subject for one device", () => {
    expect(deviceOfflineEmail(one).subject).toBe("A Maratus printer went offline");
  });
  it("plural subject for multiple devices", () => {
    const m = deviceOfflineEmail({
      orgName: "X",
      devices: [
        { name: "A", storeName: "S1", lastSeenLabel: "x" },
        { name: "B", storeName: "S2", lastSeenLabel: "y" },
      ],
    });
    expect(m.subject).toBe("2 Maratus printers went offline");
  });
  it("lists each device with name, store, and last-seen", () => {
    const { html } = deviceOfflineEmail(one);
    expect(html).toContain("Front Counter");
    expect(html).toContain("Downtown");
    expect(html).toContain("2026-06-28 11:40 UTC");
  });
  it("escapes a malicious org or device name", () => {
    const { html } = deviceOfflineEmail({
      orgName: "<script>alert(1)</script>",
      devices: [{ name: "<img src=x>", storeName: "S", lastSeenLabel: "x" }],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;script&gt;");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/devices/device-emails.test.ts`
Expected: FAIL — `Cannot find module './device-emails'`.

- [ ] **Step 3: Write the implementation**

Create `lib/devices/device-emails.ts`:

```ts
// lib/devices/device-emails.ts
// Pure builder for the tenant-facing "device went offline" email (Phase 2B).
// Reuses the shared branded layout + escaping from the billing email module.
import { emailLayout, escapeHtml } from "@/lib/billing/invoice-emails";

export function deviceOfflineEmail(input: {
  orgName: string;
  devices: { name: string; storeName: string; lastSeenLabel: string }[];
}): { subject: string; html: string } {
  const n = input.devices.length;
  const subject = n === 1 ? "A Maratus printer went offline" : `${n} Maratus printers went offline`;
  const items = input.devices
    .map(
      (d) =>
        `<li><strong>${escapeHtml(d.name)}</strong> — ${escapeHtml(d.storeName)} · last seen ${escapeHtml(d.lastSeenLabel)}</li>`,
    )
    .join("");
  const lead = n === 1 ? "One of your printers has" : `${n} of your printers have`;
  const body =
    `<p>Hi ${escapeHtml(input.orgName)},</p>` +
    `<p>${lead} stopped responding:</p>` +
    `<ul>${items}</ul>` +
    `<p>If this is unexpected, check the device's power and network connection.</p>`;
  return { subject, html: emailLayout(body) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/devices/device-emails.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm run test && npx tsc --noEmit`
Expected: all green, no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/devices/device-emails.ts lib/devices/device-emails.test.ts
git commit -m "feat(devices): pure device-offline email builder (2B)"
```

---

### Task 5: Send the offline email from the reconcile sweep

**Files:**
- Modify: `lib/alerts-sync.ts` (`reconcileOfflineDevices`)

**Interfaces:**
- Consumes: `deviceOfflineEmail` (Task 4); `getOrgEmailContext` (`lib/billing/invoice-emails.ts`); `sendEmail` (`lib/email.ts`); `store` table; existing `device` table + `shouldMarkOffline` + `recordAudit`/`AUDIT`.

- [ ] **Step 1: Add imports**

In `lib/alerts-sync.ts`, extend the schema import to add `store` and add the email imports:

```ts
import { alert as alertTable, user as userTable, device as deviceTable, store as storeTable } from "./db/schema";
import { getOrgEmailContext } from "./billing/invoice-emails";
import { deviceOfflineEmail } from "./devices/device-emails";
import { sendEmail } from "./email";
```

(`shouldMarkOffline`, `recordAudit`, `AUDIT`, `eq`, `inArray` are already imported from Task-2 of 2A / the existing file.)

- [ ] **Step 2: Widen the SELECT and add the per-org email send**

In `lib/alerts-sync.ts`, replace the whole `reconcileOfflineDevices` function with:

```ts
export async function reconcileOfflineDevices(now: Date): Promise<number> {
  const onlineRows = await db
    .select({
      id: deviceTable.id,
      organizationId: deviceTable.organizationId,
      status: deviceTable.status,
      lastSeenAt: deviceTable.lastSeenAt,
      name: deviceTable.name,
      storeName: storeTable.name,
    })
    .from(deviceTable)
    .leftJoin(storeTable, eq(storeTable.id, deviceTable.storeId))
    .where(eq(deviceTable.status, "online"));

  const toFlip = onlineRows.filter((r) => shouldMarkOffline(r, now));
  if (toFlip.length === 0) return 0;

  await db
    .update(deviceTable)
    .set({ status: "offline" })
    .where(inArray(deviceTable.id, toFlip.map((r) => r.id)));

  for (const r of toFlip) {
    await recordAudit({
      organizationId: r.organizationId,
      actor: { type: "system" },
      action: AUDIT.deviceWentOffline,
      target: { type: "device", id: r.id },
      metadata: { lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null },
    });
  }

  // Notify each affected org's owner once, listing the devices that dropped.
  const byOrg = new Map<string, typeof toFlip>();
  for (const r of toFlip) {
    const arr = byOrg.get(r.organizationId) ?? [];
    arr.push(r);
    byOrg.set(r.organizationId, arr);
  }
  for (const [orgId, devs] of byOrg) {
    const { ownerEmail, orgName } = await getOrgEmailContext(orgId);
    if (!ownerEmail) continue;
    const mail = deviceOfflineEmail({
      orgName,
      devices: devs.map((d) => ({
        name: d.name,
        storeName: d.storeName ?? "—",
        lastSeenLabel: d.lastSeenAt
          ? `${d.lastSeenAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
          : "never",
      })),
    });
    await sendEmail(ownerEmail, mail.subject, mail.html);
  }

  return toFlip.length;
}
```

- [ ] **Step 3: Typecheck + build + suite**

Run: `npx tsc --noEmit && npm run build && npm run test`
Expected: no type errors; build OK; 286+ green (no existing test drives this IO path; the audit + flip behavior is unchanged, only the email send is added).

- [ ] **Step 4: Commit**

```bash
git add lib/alerts-sync.ts
git commit -m "feat(devices): email the org owner when their device goes offline (2B)"
```

---

## Deferred acceptance (manual / cron — user)

- `/admin/customers` shows the Health column (green/amber/red + online/total).
- `/admin/customers/[id]` shows the health card (effective online/offline/paused counts, stuck docs, subscription) and the device table reflects effective status.
- With `RESEND_API_KEY` set, trigger `/api/cron/health` after letting an `online` device go stale → the owner gets ONE "device went offline" email listing it (delivery still gated on Resend domain verification → currently only `erenaltan@gmail.com`).

---

## Self-Review

**Spec coverage:**
- Pure `tenantHealthLevel` with the locked level rule (spec §A) → Task 1. ✅
- Customers-list health column + `TenantSummary` fields via already-loaded data (spec §B) → Task 2. ✅
- Customer-detail effective-status fix (local, not `mapDevice`) + health card (spec §C) → Task 3. ✅
- Pure `deviceOfflineEmail` builder (spec §D) → Task 4. ✅
- Per-org-per-sweep offline email in `reconcileOfflineDevices` (spec §D trigger) → Task 5. ✅
- No `alert` schema change; `sendEmail` never breaks the cron; escaping in the builder — honored across Tasks 1/4/5. ✅
- Testing: pure unit tests (Tasks 1, 4) + deferred manual/cron checks (spec §Testing). ✅

**Placeholder scan:** None — every code step shows complete code. ✅

**Type consistency:** `HealthLevel`/`TenantHealthInput`/`tenantHealthLevel` (Task 1) consumed identically in Tasks 2 & 3; `TenantSummary` gains `onlineCount/offlineCount/health` (Task 2) — `summarize` is the sole constructor; `CustomerDetail.health` shape (Task 3) matches the page destructure; `deviceOfflineEmail` input shape (Task 4) matches the call in Task 5; the widened reconcile SELECT supplies `name`/`storeName`. ✅

**Note for implementers:** the `mapDevice` global behavior is intentionally NOT changed — the effective-status fix is applied locally inside `getCustomerDetail` (Task 3) and the count loop in `summarize` (Task 2), per the spec's edge-case guidance. `effectiveDeviceStatus` is idempotent, so any surface that later re-applies it is unaffected.

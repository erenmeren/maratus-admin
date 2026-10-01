# Device Remote Control + Offline Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Truthful online/offline device status (from `lastSeenAt`) plus an HTTP command queue (reboot/refresh/identify) the device polls, with app-version reporting.

**Architecture:** Pure `effectiveDeviceStatus` derives status at read time (no cron); a `device_command` table + two device-key endpoints (`GET` poll/deliver + heartbeat, `POST` ack) form the queue; `/api/ingest`'s bearer-key auth is extracted into a shared `authenticateDevice`. Commands enqueued via a role-gated server action. Remote control is inert until firmware polls.

**Tech Stack:** Next.js 16 App Router, Drizzle/Neon, vitest.

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `lib/device-status.ts` | pure `effectiveDeviceStatus`, `OFFLINE_MINUTES` | Create |
| `lib/device-status.test.ts` | tests | Create |
| `lib/device-commands.ts` | pure `COMMAND_TYPES`, `isValidCommandType` | Create |
| `lib/device-commands.test.ts` | tests | Create |
| `lib/device-auth.ts` | shared `authenticateDevice(req)` | Create |
| `lib/db/schema.ts` | `device_command` table + `device.appVersion` + `Device` type export | Modify |
| `app/api/ingest/route.ts` | use `authenticateDevice`; store `X-Device-Version` | Modify |
| `app/api/device/commands/route.ts` | GET poll/deliver + heartbeat | Create |
| `app/api/device/commands/ack/route.ts` | POST ack | Create |
| `lib/actions/device-commands.ts` | `enqueueDeviceCommand` action | Create |
| `lib/audit.ts` | + `deviceCommandEnqueued` | Modify |
| `lib/data.ts` | `getDeviceCommands`; effective status in `getAllDevices` + `getPlatformHealth` | Modify |
| `components/devices/command-bar.tsx` | enqueue buttons (client) | Create |
| `app/(tenant)/tenant/stores/[storeId]/[deviceId]/page.tsx` | command bar + history + status/version | Modify |
| `docs/device-protocol.md` | firmware-facing protocol | Create |

---

## Task 1: Pure helpers (TDD)

**Files:** Create `lib/device-status.ts`, `lib/device-status.test.ts`, `lib/device-commands.ts`, `lib/device-commands.test.ts`.

- [ ] **Step 1: Write `lib/device-status.test.ts`:**

```ts
import { describe, it, expect } from "vitest";
import { effectiveDeviceStatus, OFFLINE_MINUTES } from "./device-status";

const now = new Date("2026-06-03T12:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("effectiveDeviceStatus", () => {
  it("paused always wins", () => {
    expect(effectiveDeviceStatus("paused", minsAgo(0), now)).toBe("paused");
    expect(effectiveDeviceStatus("paused", null, now)).toBe("paused");
  });
  it("null lastSeen → offline", () => {
    expect(effectiveDeviceStatus("online", null, now)).toBe("offline");
  });
  it("online when seen within threshold, offline when older", () => {
    expect(effectiveDeviceStatus("online", minsAgo(OFFLINE_MINUTES - 1), now)).toBe("online");
    expect(effectiveDeviceStatus("online", minsAgo(OFFLINE_MINUTES + 1), now)).toBe("offline");
  });
  it("online exactly at threshold (strictly greater is offline)", () => {
    expect(effectiveDeviceStatus("online", minsAgo(OFFLINE_MINUTES), now)).toBe("online");
  });
});
```

- [ ] **Step 2: Write `lib/device-commands.test.ts`:**

```ts
import { describe, it, expect } from "vitest";
import { isValidCommandType, COMMAND_TYPES } from "./device-commands";

describe("isValidCommandType", () => {
  it("accepts the known types", () => {
    for (const t of COMMAND_TYPES) expect(isValidCommandType(t)).toBe(true);
  });
  it("rejects unknown", () => {
    expect(isValidCommandType("shutdown")).toBe(false);
    expect(isValidCommandType("")).toBe(false);
  });
});
```

- [ ] **Step 3: Run both, expect FAIL**

Run: `npm test -- lib/device-status.test.ts lib/device-commands.test.ts`

- [ ] **Step 4: Implement `lib/device-status.ts`:**

```ts
// lib/device-status.ts
// Pure: derive a device's effective online/offline status from lastSeenAt.

export const OFFLINE_MINUTES = 15;
export type DeviceStatus = "online" | "offline" | "paused";

/** Paused wins; else offline if never/too-long since seen; else online. */
export function effectiveDeviceStatus(
  storedStatus: string,
  lastSeenAt: Date | null,
  now: Date,
  offlineMinutes = OFFLINE_MINUTES,
): DeviceStatus {
  if (storedStatus === "paused") return "paused";
  if (!lastSeenAt) return "offline";
  return now.getTime() - lastSeenAt.getTime() > offlineMinutes * 60_000
    ? "offline"
    : "online";
}
```

- [ ] **Step 5: Implement `lib/device-commands.ts`:**

```ts
// lib/device-commands.ts
// Pure: device command types + validation.

export const COMMAND_TYPES = ["reboot", "refresh", "identify"] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export function isValidCommandType(t: string): t is CommandType {
  return (COMMAND_TYPES as readonly string[]).includes(t);
}
```

- [ ] **Step 6: Run, expect PASS; then `npm test`** (full suite).

- [ ] **Step 7: Commit**

```bash
git add lib/device-status.ts lib/device-status.test.ts lib/device-commands.ts lib/device-commands.test.ts
git commit -m "feat: pure device effective-status + command-type helpers"
```

---

## Task 2: Schema — device_command + appVersion

**Files:** Modify `lib/db/schema.ts`.

- [ ] **Step 1: Add `appVersion` to the `device` table** — add a column (e.g. after `lastSeenAt`):

```ts
    appVersion: text("app_version"),
```

- [ ] **Step 2: Add the `device_command` table** — after the `device` table, before the `receipt` table (it references `device` and `organization`, both defined above it):

```ts
export const deviceCommand = pgTable(
  "device_command",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id").notNull().references(() => device.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["reboot", "refresh", "identify"] }).notNull(),
    status: text("status", { enum: ["pending", "delivered", "acked", "failed"] }).default("pending").notNull(),
    result: text("result"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
    deliveredAt: timestamp("delivered_at"),
    ackedAt: timestamp("acked_at"),
  },
  (t) => [index("device_command_device_status_idx").on(t.deviceId, t.status)],
);
```

- [ ] **Step 3: Export a `Device` row type** (used by `authenticateDevice`) — near the bottom, after the `schema` map (or anywhere top-level):

```ts
export type DeviceRowT = typeof device.$inferSelect;
```

- [ ] **Step 4: Register `deviceCommand` in the `schema` map** — add `deviceCommand,` to the `export const schema = { ... }` object.

- [ ] **Step 5: Generate + apply the migration**

Run: `npm run db:generate`
Expected: a migration with `ALTER TABLE "device" ADD COLUMN "app_version"`, `CREATE TABLE "device_command"`, its FK constraints, and the index. Additive only — inspect; STOP/BLOCK if it drops anything.

Run: `npm run db:migrate`
Expected: applies cleanly.

- [ ] **Step 6: tsc + commit**

Run: `npx tsc --noEmit`

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat: device_command table + device.appVersion column"
```

---

## Task 3: Shared `authenticateDevice` + ingest refactor

**Files:** Create `lib/device-auth.ts`; Modify `app/api/ingest/route.ts`.

- [ ] **Step 1: Create `lib/device-auth.ts`:**

```ts
// lib/device-auth.ts
// Shared device bearer-key authentication (used by ingest + command endpoints).

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, type DeviceRowT } from "@/lib/db/schema";
import { hashDeviceKey } from "@/lib/ids";

/** Resolve the device from `Authorization: Bearer <deviceKey>`, or null. */
export async function authenticateDevice(req: Request): Promise<DeviceRowT | null> {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const keyHash = hashDeviceKey(match[1].trim());
  const [device] = await db
    .select()
    .from(deviceTable)
    .where(eq(deviceTable.deviceKeyHash, keyHash))
    .limit(1);
  return device ?? null;
}
```

- [ ] **Step 2: Refactor `/api/ingest`** to use it. Replace the inline auth block:

```ts
  // --- 1. Authenticate the device by its bearer key ----------------------
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return bad(401, "Missing device bearer token");

  const keyHash = hashDeviceKey(match[1].trim());
  const [device] = await db
    .select()
    .from(deviceTable)
    .where(eq(deviceTable.deviceKeyHash, keyHash))
    .limit(1);

  if (!device) return bad(401, "Unknown device key");
```

with:

```ts
  // --- 1. Authenticate the device by its bearer key ----------------------
  const device = await authenticateDevice(req);
  if (!device) return bad(401, "Unknown or missing device key");
```

Add the import `import { authenticateDevice } from "@/lib/device-auth";`. The
`keyHash` variable was also used later for the rate-limit key — replace that
usage with `device.deviceKeyHash` (which holds the same hash). Find
`checkRateLimit(keyHash, ...)` and change it to `checkRateLimit(device.deviceKeyHash, ...)`.
Remove the now-unused `hashDeviceKey` import only if nothing else uses it
(`id`, `receiptToken` stay).

- [ ] **Step 3: Store `X-Device-Version` on ingest** — where the device heartbeat
is bumped (`db.update(deviceTable).set({ lastSeenAt: now, status: "online" })`),
include the version when present:

```ts
  const version = req.headers.get("x-device-version");
  await db
    .update(deviceTable)
    .set({ lastSeenAt: now, status: "online", ...(version ? { appVersion: version } : {}) })
    .where(eq(deviceTable.id, device.id));
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/device-auth.ts app/api/ingest/route.ts
git commit -m "refactor: shared authenticateDevice; ingest stores app version"
```

---

## Task 4: Device command endpoints

**Files:** Create `app/api/device/commands/route.ts`, `app/api/device/commands/ack/route.ts`.

- [ ] **Step 1: GET poll/deliver** `app/api/device/commands/route.ts`:

```ts
// GET /api/device/commands — device polls for pending commands (device key).
// Doubles as a heartbeat: bumps lastSeenAt + app version, returns + delivers.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, deviceCommand } from "@/lib/db/schema";
import { authenticateDevice } from "@/lib/device-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const device = await authenticateDevice(req);
  if (!device) return NextResponse.json({ error: "Unknown or missing device key" }, { status: 401 });

  const now = new Date();
  const version = req.headers.get("x-device-version");
  // Heartbeat — never override a paused device to online.
  await db
    .update(deviceTable)
    .set({
      lastSeenAt: now,
      ...(device.status === "paused" ? {} : { status: "online" }),
      ...(version ? { appVersion: version } : {}),
    })
    .where(eq(deviceTable.id, device.id));

  const delivered = await db
    .update(deviceCommand)
    .set({ status: "delivered", deliveredAt: now })
    .where(and(eq(deviceCommand.deviceId, device.id), eq(deviceCommand.status, "pending")))
    .returning({ id: deviceCommand.id, type: deviceCommand.type });

  return NextResponse.json({ commands: delivered });
}
```

- [ ] **Step 2: POST ack** `app/api/device/commands/ack/route.ts`:

```ts
// POST /api/device/commands/ack — device acknowledges a command (device key).
// Body: { commandId: string, ok: boolean, result?: string }

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { deviceCommand } from "@/lib/db/schema";
import { authenticateDevice } from "@/lib/device-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const device = await authenticateDevice(req);
  if (!device) return NextResponse.json({ error: "Unknown or missing device key" }, { status: 401 });

  let body: { commandId?: string; ok?: boolean; result?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  if (!body.commandId) return NextResponse.json({ error: "Missing commandId" }, { status: 400 });

  await db
    .update(deviceCommand)
    .set({ status: body.ok ? "acked" : "failed", ackedAt: new Date(), result: body.result ?? null })
    .where(and(eq(deviceCommand.id, body.commandId), eq(deviceCommand.deviceId, device.id)));

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: clean; tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/api/device/commands/
git commit -m "feat: device command poll + ack endpoints"
```

---

## Task 5: Enqueue action + audit + data fn

**Files:** Create `lib/actions/device-commands.ts`; Modify `lib/audit.ts`, `lib/data.ts`.

- [ ] **Step 1: Add the audit constant** — in `lib/audit.ts` `AUDIT` object, after `deviceUnassigned`:

```ts
  deviceCommandEnqueued: "device.command_enqueued",
```

- [ ] **Step 2: Create the enqueue action** `lib/actions/device-commands.ts`:

```ts
// lib/actions/device-commands.ts
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { device as deviceTable, deviceCommand } from "@/lib/db/schema";
import { getContext } from "@/lib/session";
import { isValidCommandType } from "@/lib/device-commands";
import { id as genId } from "@/lib/ids";
import { recordAudit, AUDIT } from "@/lib/audit";

type Result = { ok: true } | { ok: false; error: string };

export async function enqueueDeviceCommand(deviceId: string, type: string): Promise<Result> {
  if (!isValidCommandType(type)) return { ok: false, error: "Invalid command." };
  const ctx = await getContext();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const [dev] = await db
    .select({ id: deviceTable.id, organizationId: deviceTable.organizationId })
    .from(deviceTable)
    .where(eq(deviceTable.id, deviceId))
    .limit(1);
  if (!dev) return { ok: false, error: "Device not found." };

  const isPlatformAdmin = ctx.user.role === "platform_admin";
  const orgRole = ctx.organizations.find((o) => o.id === dev.organizationId)?.role;
  const canCommand = isPlatformAdmin || orgRole === "owner" || orgRole === "admin";
  if (!canCommand) return { ok: false, error: "Not allowed." };

  await db.insert(deviceCommand).values({
    id: genId("cmd"),
    deviceId: dev.id,
    organizationId: dev.organizationId,
    type,
    createdByUserId: ctx.user.id,
  });
  await recordAudit({
    organizationId: dev.organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.deviceCommandEnqueued,
    target: { type: "device", id: dev.id },
    metadata: { type },
  });
  revalidatePath(`/tenant/stores`);
  revalidatePath("/admin/devices");
  return { ok: true };
}
```

- [ ] **Step 3: Add `getDeviceCommands`** to `lib/data.ts` (recent commands for a device):

```ts
export async function getDeviceCommands(deviceId: string, limit = 20) {
  const { deviceCommand } = await import("@/lib/db/schema");
  const { eq, desc } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(deviceCommand)
    .where(eq(deviceCommand.deviceId, deviceId))
    .orderBy(desc(deviceCommand.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    ackedAt: r.ackedAt ? r.ackedAt.toISOString() : null,
  }));
}
```

> If `lib/data.ts` already imports `deviceCommand`/`eq`/`desc` at the top (it imports `eq`/`desc`), prefer the top-level imports and add `deviceCommand` to the schema import — match the file's convention.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: clean; tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/device-commands.ts lib/audit.ts lib/data.ts
git commit -m "feat: enqueue device command action + history query"
```

---

## Task 6: Apply effective status (fleet + health)

**Files:** Modify `lib/data.ts`.

- [ ] **Step 1: Import the helper** — add to `lib/data.ts`:

```ts
import { effectiveDeviceStatus } from "./device-status";
```

- [ ] **Step 2: Override status in `getAllDevices`** — find the `getAllDevices` function (it pushes `{ ...device, tenantName, storeName }`). Compute a `now` once at the top of the function and change the pushed object's `status` to the effective one:

```ts
  const now = new Date();
  // ... inside the loop where it builds the row:
  rows.push({
    ...device,
    status: effectiveDeviceStatus(device.status, device.lastSeenAt, now),
    tenantName: tenant.name,
    storeName: store.name,
  });
```

(The `...device` spread sets `status` first; the explicit `status:` after it overrides — keep that ordering.)

- [ ] **Step 3: Make `getPlatformHealth` fleet counts effective** — replace the status group-by block (the `statusRows`/`byStatus` section) with a row-level computation:

```ts
    const devRows = await db
      .select({ status: deviceTable.status, lastSeenAt: deviceTable.lastSeenAt })
      .from(deviceTable);
    const byStatus = { online: 0, offline: 0, paused: 0 } as Record<string, number>;
    for (const d of devRows) {
      byStatus[effectiveDeviceStatus(d.status, d.lastSeenAt, now)] += 1;
    }
    const total = devRows.length;
```

(`now` is already defined at the top of `getPlatformHealth`. Remove the old
`statusRows` query and the `let total` loop it fed. The existing `stalePred`
stale-list query stays as-is — it lists which devices are stale.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: clean; 39+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/data.ts
git commit -m "feat: derive effective device status in fleet + health"
```

---

## Task 7: Command bar UI + device detail + protocol doc

**Files:** Create `components/devices/command-bar.tsx`, `docs/device-protocol.md`; Modify `app/(tenant)/tenant/stores/[storeId]/[deviceId]/page.tsx`.

- [ ] **Step 1: Command bar (client)** `components/devices/command-bar.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { enqueueDeviceCommand } from "@/lib/actions/device-commands";

const ACTIONS: { type: string; label: string }[] = [
  { type: "reboot", label: "Reboot" },
  { type: "refresh", label: "Refresh config" },
  { type: "identify", label: "Identify" },
];

export function CommandBar({ deviceId }: { deviceId: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send(type: string) {
    setMsg(null);
    start(async () => {
      const r = await enqueueDeviceCommand(deviceId, type);
      setMsg(r.ok ? `${type} queued — the device will pick it up on its next check-in.` : r.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <Button key={a.type} variant="outline" size="sm" disabled={pending} onClick={() => send(a.type)}>
            {a.label}
          </Button>
        ))}
      </div>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Wire into the tenant device detail page** — READ
`app/(tenant)/tenant/stores/[storeId]/[deviceId]/page.tsx` first. It calls
`getDevice(deviceId)` → `{ device, store, tenant }` and renders detail with
`DevicePauseControl` and `timeAgo`. Add:
  - import `{ CommandBar } from "@/components/devices/command-bar"`,
    `{ getDeviceCommands } from "@/lib/data"`, `{ effectiveDeviceStatus } from "@/lib/device-status"`,
    `{ requireTenant }` is already imported.
  - After loading the device, also `const commands = await getDeviceCommands(deviceId);`
    and `const status = effectiveDeviceStatus(device.status, device.lastSeenAt, new Date());`.
  - Render the effective `status`, `device.lastSeenAt ? timeAgo(device.lastSeenAt.toISOString()) : "never"`,
    and `device.appVersion ?? "unknown"` in the detail header/cards (adapt to the
    existing markup — replace the raw `device.status` display with `status`).
  - Add a "Remote control" section: `<CommandBar deviceId={device.id} />` and a
    recent-commands list:

```tsx
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Remote control</h2>
        <CommandBar deviceId={device.id} />
        {commands.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="py-2">Command</th><th>Status</th><th>Queued</th></tr></thead>
            <tbody>
              {commands.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="py-2">{c.type}</td>
                  <td>{c.status}</td>
                  <td>{c.createdAt.slice(0, 19).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
```

  > Adapt to the page's actual JSX/wrappers; do not remove existing sections. If
  the device-detail page uses a `Device` view-model type without `appVersion`/
  `lastSeenAt`, read from the raw `device` row returned by `getDevice` (it's the
  full DB row).

- [ ] **Step 3: Protocol doc** `docs/device-protocol.md`:

```markdown
# Maratus Device Protocol

All device endpoints authenticate with the device key:
`Authorization: Bearer <deviceKey>` (issued once at claim). Optional header
`X-Device-Version: <semver>` reports the app version (stored + shown in the fleet).

## POST /api/ingest
Upload a rendered receipt (multipart `file`, or JSON `{ image: base64 }`).
Returns `{ token, url }`. Also acts as a heartbeat.

## GET /api/device/commands
Poll for pending commands. Recommended interval: 30–60s. Response:
`{ "commands": [ { "id": "cmd_…", "type": "reboot" | "refresh" | "identify" } ] }`.
Returned commands are marked **delivered**. This call is also a heartbeat
(updates last-seen + version).

## POST /api/device/commands/ack
Body: `{ "commandId": "cmd_…", "ok": true|false, "result": "optional string" }`.
Marks the command `acked` (ok) or `failed`.

## Commands
- `reboot` — restart the device.
- `refresh` — re-pull config/branding.
- `identify` — briefly flash the screen to locate the kiosk.

A device that does not poll `GET /api/device/commands` cannot receive commands;
remote control requires firmware support for this loop.
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: clean; routes `/api/device/commands` + `/api/device/commands/ack` and the device detail page build.

- [ ] **Step 5: Commit**

```bash
git add components/devices/ "app/(tenant)/tenant/stores/[storeId]/[deviceId]/page.tsx" docs/device-protocol.md
git commit -m "feat: device command bar, history, and protocol doc"
```

---

## Task 8: Manual verification (human-run)

- [ ] In `npm run db:studio`, age a claimed online device's `last_seen_at` to >15m
      ago → it shows **offline** in `/admin/devices`, the device detail, and the
      `/admin/health` fleet counts; `/admin/health` "stale" still lists it.
- [ ] On the tenant device detail page (as `dana@roastwell.co`, owner), click
      **Reboot** → a `device.command_enqueued` audit row appears + the command
      shows `pending` in the history.
- [ ] Simulate the device:
      `curl -H "Authorization: Bearer <deviceKey>" -H "X-Device-Version: 1.2.3" https://<app>/api/device/commands`
      → returns the reboot command + marks it delivered; device row shows
      `appVersion=1.2.3` and a fresh `last_seen_at`.
- [ ] `curl -X POST -H "Authorization: Bearer <deviceKey>" -H 'content-type: application/json' -d '{"commandId":"cmd_…","ok":true}' .../api/device/commands/ack`
      → command flips to `acked`.
- [ ] Confirm a tenant `member` (non owner/admin) gets "Not allowed" from enqueue.

---

## Self-Review

- **Spec coverage:** effective status (T1, applied T6); command types (T1); schema (T2); shared auth + ingest refactor + version (T3); poll/ack endpoints (T4); enqueue + authority + audit + history (T5); UI + protocol doc (T7); manual (T8). All spec sections mapped.
- **Placeholder scan:** no logic placeholders; T7's "adapt to the page's JSX" is an integration note (the new section code is complete).
- **Type consistency:** `effectiveDeviceStatus`/`OFFLINE_MINUTES` (T1) used in T6/T7; `isValidCommandType`/`COMMAND_TYPES` (T1) used in T5; `authenticateDevice`→`DeviceRowT` (T2/T3) used in T3/T4; `deviceCommand` columns (T2) used in T4/T5/T6; `enqueueDeviceCommand` (T5) called by CommandBar (T7); `getDeviceCommands` (T5) consumed by the detail page (T7); `AUDIT.deviceCommandEnqueued` (T5).

## Execution notes

- **Runs green now:** Task 1 (pure). T2 migration needs `DATABASE_URL`.
- **No external services.** Remote control is **inert until kiosk firmware polls** `/api/device/commands` (documented). Device endpoints are exercisable by hand with `curl` + a real device key (T8).

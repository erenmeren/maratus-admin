# M6b Cloud — Firmware publish + OTA manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloud side of OTA — a platform admin publishes a firmware `.bin` (→ R2 + a release row), and devices fetch the latest release via a new `GET /api/device/firmware` manifest; plus a `firmware-update` command + admin UI.

**Architecture:** New `firmwareRelease` table records each published build (version, R2 key, sha256, size). A platform-admin page uploads the `.bin` (sha256 + `putObject` to R2 + insert row). `GET /api/device/firmware` (device-key auth) returns the latest release as `{version, url(presigned R2), sha256, size}` (204 if none). The manifest shape is a pure, unit-tested helper. `firmware-update` is added to the command enum + CommandBar.

**Tech Stack:** Next.js (App Router route handlers + server actions), Drizzle/Neon, Cloudflare R2 via `lib/storage.ts`, vitest, `node:crypto`.

This is **Plan 1 of 2** for M6b. Plan 2 (firmware OTA client) consumes this and is written after this lands. Spec: `docs/superpowers/specs/2026-06-20-firmware-m6b-ota-design.md`.

---

### Task 1: `firmwareRelease` table

**Files:** Modify `lib/db/schema.ts`; generate migration under `drizzle/`.

- [ ] **Step 1: Add the table**

In `lib/db/schema.ts`, ensure `integer` is in the `drizzle-orm/pg-core` import (add it if missing). Add this table near `deviceCommand`:
```ts
// Published firmware builds for OTA. "Latest" = newest createdAt. M6b.
export const firmwareRelease = pgTable("firmware_release", {
  id: text("id").primaryKey(),
  version: text("version").notNull().unique(),
  r2Key: text("r2_key").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/00NN_*.sql` creating `firmware_release` with a unique constraint on `version`, touching no other table.

- [ ] **Step 3: Apply it**

Run: `npm run db:migrate`
Expected: applies cleanly against Neon.

- [ ] **Step 4: Commit**
```bash
git add lib/db/schema.ts drizzle
git commit -m "feat(db): firmware_release table for OTA releases"
```

---

### Task 2: storage key + pure manifest helper

**Files:** Modify `lib/storage.ts`; Create `lib/firmware.ts`, `lib/firmware.test.ts`.

- [ ] **Step 1: Add the storage key**

In `lib/storage.ts`, add next to the other `*StorageKey` helpers:
```ts
/** R2 key for a published firmware binary. */
export function firmwareStorageKey(version: string): string {
  return `firmware/${version}/maratus-firmware.bin`;
}
```

- [ ] **Step 2: Write the failing test**

Create `lib/firmware.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { latestFirmwareManifest } from "./firmware";
import { firmwareStorageKey } from "./storage";

describe("latestFirmwareManifest", () => {
  it("returns null when there is no release", () => {
    expect(latestFirmwareManifest(null, null)).toBeNull();
  });
  it("returns null when there is no url", () => {
    expect(latestFirmwareManifest({ version: "1", sha256: "a", sizeBytes: 1 }, null)).toBeNull();
  });
  it("builds the manifest from a release + presigned url", () => {
    expect(
      latestFirmwareManifest({ version: "0.3.0", sha256: "deadbeef", sizeBytes: 1599264 }, "https://r2/sig"),
    ).toEqual({ version: "0.3.0", url: "https://r2/sig", sha256: "deadbeef", size: 1599264 });
  });
});

describe("firmwareStorageKey", () => {
  it("namespaces by version", () => {
    expect(firmwareStorageKey("0.3.0")).toBe("firmware/0.3.0/maratus-firmware.bin");
  });
});
```

- [ ] **Step 3: Run → FAIL**

Run: `npx vitest run lib/firmware.test.ts`
Expected: FAIL — cannot find `./firmware`.

- [ ] **Step 4: Implement**

Create `lib/firmware.ts`:
```ts
// Pure OTA-manifest shaping, DB-free for unit-testing. The route does the DB
// lookup + R2 presign, then calls this.

export interface FirmwareManifest {
  version: string;
  url: string;
  sha256: string;
  size: number;
}

/** Shape the device-facing manifest from the latest release row + a presigned URL. */
export function latestFirmwareManifest(
  release: { version: string; sha256: string; sizeBytes: number } | null,
  url: string | null,
): FirmwareManifest | null {
  if (!release || !url) return null;
  return { version: release.version, url, sha256: release.sha256, size: release.sizeBytes };
}
```

- [ ] **Step 5: Run → PASS**

Run: `npx vitest run lib/firmware.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**
```bash
git add lib/storage.ts lib/firmware.ts lib/firmware.test.ts
git commit -m "feat: firmwareStorageKey + latestFirmwareManifest helper"
```

---

### Task 3: `firmware-update` command type

**Files:** Modify `lib/device-commands.ts`; `lib/db/schema.ts` (the `deviceCommand` enum).

- [ ] **Step 1: Add to the validated list**

In `lib/device-commands.ts`, extend the tuple:
```ts
export const COMMAND_TYPES = ["reboot", "refresh", "identify", "config-changed", "firmware-update"] as const;
```

- [ ] **Step 2: Add to the schema enum**

In `lib/db/schema.ts`, the `deviceCommand` `type` column (currently `enum: ["reboot", "refresh", "identify", "config-changed"]`) — add `"firmware-update"`:
```ts
    type: text("type", { enum: ["reboot", "refresh", "identify", "config-changed", "firmware-update"] }).notNull(),
```
(Drizzle `text({enum})` is a TS-level constraint on a plain text column — **no DB migration needed**.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**
```bash
git add lib/device-commands.ts lib/db/schema.ts
git commit -m "feat: firmware-update device command type"
```

---

### Task 4: `GET /api/device/firmware` manifest endpoint

**Files:** Create `app/api/device/firmware/route.ts`.

- [ ] **Step 1: Write the route**

Create `app/api/device/firmware/route.ts`:
```ts
// GET /api/device/firmware — device-key auth. Returns the latest published firmware
// release as { version, url, sha256, size } (url = short-lived presigned R2 GET), or
// 204 when nothing is published.

import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { firmwareRelease } from "@/lib/db/schema";
import { authenticateDevice } from "@/lib/device-auth";
import { presignedGetUrl } from "@/lib/storage";
import { latestFirmwareManifest } from "@/lib/firmware";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const device = await authenticateDevice(req);
  if (!device) {
    return NextResponse.json({ error: "Unknown or missing device key" }, { status: 401 });
  }

  const [rel] = await db
    .select()
    .from(firmwareRelease)
    .orderBy(desc(firmwareRelease.createdAt))
    .limit(1);
  if (!rel) return new NextResponse(null, { status: 204 });

  const url = await presignedGetUrl(rel.r2Key, 600); // 10-min TTL; a ~1.5MB OTA is seconds
  return NextResponse.json(latestFirmwareManifest(rel, url));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add app/api/device/firmware/route.ts
git commit -m "feat(api): GET /api/device/firmware OTA manifest"
```

---

### Task 5: Publish action + admin Firmware page

**Files:** Create `lib/actions/firmware.ts`; Create `app/(admin)/admin/firmware/page.tsx`, `app/(admin)/admin/firmware/publish-form.tsx`.

- [ ] **Step 1: Publish server action**

Create `lib/actions/firmware.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { firmwareRelease } from "@/lib/db/schema";
import { requirePlatformAdmin } from "@/lib/session";
import { id } from "@/lib/ids";
import { firmwareStorageKey, putObject } from "@/lib/storage";

type Result = { ok: true; version: string } | { ok: false; error: string };

export async function publishFirmware(formData: FormData): Promise<Result> {
  const ctx = await requirePlatformAdmin();

  const version = String(formData.get("version") ?? "").trim();
  const file = formData.get("file");
  if (!version) {
    return { ok: false, error: "Enter a version (must match the build's CONFIG_MARATUS_FW_VERSION)." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a firmware .bin file." };
  }
  if (file.size > 8 * 1024 * 1024) {
    return { ok: false, error: "File too large (>8MB)." };
  }

  const [dup] = await db
    .select({ id: firmwareRelease.id })
    .from(firmwareRelease)
    .where(eq(firmwareRelease.version, version))
    .limit(1);
  if (dup) return { ok: false, error: `Version ${version} is already published.` };

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const key = firmwareStorageKey(version);
  await putObject(key, bytes, "application/octet-stream");

  await db.insert(firmwareRelease).values({
    id: id("fwr"),
    version,
    r2Key: key,
    sha256,
    sizeBytes: bytes.length,
    createdByUserId: ctx.user.id,
    createdAt: new Date(),
  });

  revalidatePath("/admin/firmware");
  return { ok: true, version };
}
```

- [ ] **Step 2: Upload form (client)**

Create `app/(admin)/admin/firmware/publish-form.tsx`:
```tsx
"use client";

import * as React from "react";
import { publishFirmware } from "@/lib/actions/firmware";

export function PublishForm() {
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await publishFirmware(new FormData(e.currentTarget));
    setBusy(false);
    setMsg(r.ok ? `Published ${r.version}.` : r.error);
    if (r.ok) e.currentTarget.reset();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 max-w-md">
      <input name="version" placeholder="Version (e.g. 0.3.0-m6b)" required
             className="rounded-md border px-3 py-2 text-sm" />
      <input name="file" type="file" accept=".bin,application/octet-stream" required
             className="text-sm" />
      <button type="submit" disabled={busy}
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">
        {busy ? "Publishing…" : "Publish firmware"}
      </button>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Admin page (server) — list + form**

Create `app/(admin)/admin/firmware/page.tsx`:
```tsx
import { desc } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { firmwareRelease } from "@/lib/db/schema";
import { PublishForm } from "./publish-form";

export default async function FirmwarePage() {
  await requirePlatformAdmin();
  const releases = await db
    .select()
    .from(firmwareRelease)
    .orderBy(desc(firmwareRelease.createdAt))
    .limit(50);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">Firmware</h1>
        <p className="text-sm text-muted-foreground">
          Upload a build (its version must match the binary's CONFIG_MARATUS_FW_VERSION). The newest
          release is what devices fetch via the OTA manifest.
        </p>
      </div>
      <PublishForm />
      <table className="text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-6">Version</th><th className="py-1 pr-6">Size</th>
            <th className="py-1 pr-6">SHA-256</th><th className="py-1">Published</th>
          </tr>
        </thead>
        <tbody>
          {releases.map((r, i) => (
            <tr key={r.id} className="border-t">
              <td className="py-1 pr-6">{r.version}{i === 0 ? " (latest)" : ""}</td>
              <td className="py-1 pr-6">{(r.sizeBytes / 1024).toFixed(0)} KB</td>
              <td className="py-1 pr-6 font-mono text-xs">{r.sha256.slice(0, 12)}…</td>
              <td className="py-1">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
            </tr>
          ))}
          {releases.length === 0 && (
            <tr><td colSpan={4} className="py-2 text-muted-foreground">No releases yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: builds; the new admin route compiles. (If the admin nav/sidebar is a static list, add a "Firmware" link to it the same way "Devices"/"Health" are listed — check the admin layout/nav and follow that pattern; if nav is auto-derived, skip.)

- [ ] **Step 5: Commit**
```bash
git add lib/actions/firmware.ts "app/(admin)/admin/firmware"
git commit -m "feat(admin): publish-firmware page + action"
```

---

### Task 6: "Update firmware" command button + running-vs-latest on device detail

**Files:** Modify `components/devices/command-bar.tsx`; `app/(tenant)/tenant/stores/[storeId]/[deviceId]/page.tsx`.

- [ ] **Step 1: Add the CommandBar action**

In `components/devices/command-bar.tsx`, add to the `ACTIONS` array:
```ts
  { type: "firmware-update", label: "Update firmware" },
```

- [ ] **Step 2: Show running vs latest on the device page**

In `app/(tenant)/tenant/stores/[storeId]/[deviceId]/page.tsx`, fetch the latest release and surface it next to the firmware line. Near the other imports add:
```ts
import { desc } from "drizzle-orm";
import { firmwareRelease } from "@/lib/db/schema";
```
After the device is loaded, add:
```ts
  const [latestFw] = await db
    .select({ version: firmwareRelease.version })
    .from(firmwareRelease)
    .orderBy(desc(firmwareRelease.createdAt))
    .limit(1);
  const updateAvailable = latestFw && latestFw.version !== device.firmwareVersion;
```
Then change the Firmware detail value to show both (follow the existing detail-row rendering; the firmware row is currently `value: \`v${device.firmwareVersion}\``):
```ts
    value: `v${device.firmwareVersion}${updateAvailable ? ` → v${latestFw.version} available` : ""}`,
```
(Match the file's actual detail-row structure; if `db` isn't imported there yet, add `import { db } from "@/lib/db"`.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: builds clean.

- [ ] **Step 4: Commit**
```bash
git add components/devices/command-bar.tsx "app/(tenant)/tenant/stores/[storeId]/[deviceId]/page.tsx"
git commit -m "feat(ui): Update-firmware command + running-vs-latest on device page"
```

---

### Task 7: Tests + end-to-end verification

- [ ] **Step 1: Add an isValidCommandType assertion**

Append to an existing test (or create `lib/device-commands.test.ts` if none) — confirm `firmware-update` validates:
```ts
import { describe, it, expect } from "vitest";
import { isValidCommandType } from "./device-commands";
describe("isValidCommandType", () => {
  it("accepts firmware-update", () => expect(isValidCommandType("firmware-update")).toBe(true));
  it("rejects junk", () => expect(isValidCommandType("nope")).toBe(false));
});
```
Run: `npx vitest run lib/device-commands.test.ts` → PASS.

- [ ] **Step 2: Full test suite**

Run: `npm run test`
Expected: all green (incl. `lib/firmware.test.ts`).

- [ ] **Step 3: Manual endpoint check (no release)**

`npm run dev`, then (device key from a claimed device; use one from the DB or the seed):
`curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <devkey>" "http://localhost:3000/api/device/firmware"`
Expected: `204` (no release yet). Without the header → `401`.

- [ ] **Step 4: Publish + manifest check**

In the dashboard as the platform admin (`admin@maratus.app`), open `/admin/firmware`, publish a small dummy `.bin` with version `0.3.0-test`. Then:
`curl -s -H "Authorization: Bearer <devkey>" "http://localhost:3000/api/device/firmware"`
Expected: `{"version":"0.3.0-test","url":"https://...r2...","sha256":"...","size":...}`. Confirm the R2 object exists (db:studio shows the `firmware_release` row). Re-publishing `0.3.0-test` → rejected ("already published").

- [ ] **Step 5: Deploy note**

Deploy is part of M6b finalization (with the firmware plan). The migration must be applied to prod before deploy. (Do NOT deploy mid-feature; ship cloud + firmware together, per the M6a pattern.)

---

## Self-Review

**Spec coverage:**
- `firmwareRelease` table → Task 1. ✓
- `firmwareStorageKey` + manifest helper → Task 2. ✓
- `firmware-update` command type (enum + validator) → Task 3. ✓
- `GET /api/device/firmware` (device-key, latest, presigned, 204) → Tasks 2 (helper) + 4 (route). ✓
- Publish: admin upload → sha256 → R2 → row, dup-rejected → Task 5. ✓
- CommandBar "Update firmware" + running-vs-latest UI → Task 6. ✓
- Tests + curl verification → Task 7. ✓

**Placeholder scan:** complete code for table/helper/route/action/form/page; UI-wiring steps (admin nav link in Task 5.4, detail-row shape in Task 6.2) say "match the file's actual structure" with the exact field to change — real adaptation notes, not placeholders.

**Type consistency:** `firmwareRelease` columns (`version`, `r2Key`, `sha256`, `sizeBytes`, `createdAt`) used consistently in the route (Task 4), action (Task 5), and device page (Task 6). `latestFirmwareManifest(release, url)` signature consistent between Task 2 and Task 4. `firmware-update` consistent across `COMMAND_TYPES`, schema enum, and CommandBar.

**Out of scope (firmware plan / later):** the OTA client (esp_https_ota, rollback, triggers), channels/staged rollouts.

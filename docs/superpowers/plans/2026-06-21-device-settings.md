# Device Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant "Device Settings" page (under Branding) where owners/admins set five org-wide device policies — QR visible duration, screen brightness, sleep on/off, sleep inactivity timeout, and the on-device Settings PIN — delivered to every device through the existing config channel.

**Architecture:** New columns on `tenantSettings` (the existing 1:1-with-org config row). A pure `lib/device-settings.ts` module owns clamping + password hashing (host-tested). The new values feed `computeConfigVersion()` (so the ETag bumps) and are surfaced in `DeviceConfigPayload.device` from `getDeviceConfig()`. A `saveDeviceSettings` server action upserts the columns and calls the existing `enqueueConfigChangedForOrg()` to nudge every device to re-pull. QR duration is promoted from the printer-config JSON to a dedicated `qrVisibleSeconds` column (overlaid back onto `config.qrTimeoutSeconds` at delivery so the firmware contract is unchanged); the editable control is removed from the Branding editor.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Drizzle ORM over Neon, shadcn/ui (radix-nova: Slider, Switch, Select, Input, Label, Button, Card), sonner toasts, Vitest.

## Global Constraints

- Money/units rule does not apply here, but **all numeric settings are stored as integers** and clamped server-side; bad input must never reach the DB or a device.
- **Validation ranges (authoritative):** `qrVisibleSeconds` 15–180; `screenBrightness` 10–100; `screenSleepTimeoutSeconds` 30–3600.
- **Password:** stored as `sha256(salt + password)` with a random per-set salt; the admin UI never receives the hash, only `hasPassword: boolean`.
- **Auth:** every mutation gated to org `owner`/`admin` (same check as `saveBranding`).
- **Propagation:** reuse `enqueueConfigChangedForOrg()` + the `config-changed` command; do NOT add a new command type.
- **Device contract stability:** the device keeps reading `config.qrTimeoutSeconds`; the new column is overlaid onto it at delivery.
- Follow existing patterns verbatim (see `app/(tenant)/tenant/branding/actions.ts`, `lib/data.ts`, `components/branding-editor.tsx`).
- Run `npx tsc --noEmit` and `npm run test` green before each commit.

---

### Task 1: Pure device-settings module (clamp + password hashing)

**Files:**
- Create: `lib/device-settings.ts`
- Test: `lib/device-settings.test.ts`

**Interfaces:**
- Produces:
  - `interface DeviceSettings { qrVisibleSeconds: number; screenBrightness: number; screenSleepEnabled: boolean; screenSleepTimeoutSeconds: number }`
  - `function normalizeDeviceSettings(input: unknown): DeviceSettings` — clamps to the authoritative ranges, applies defaults (60/100/false/300) on missing/garbage values.
  - `function hashSettingsPassword(password: string): { hash: string; salt: string }`
  - `function verifySettingsPassword(password: string, hash: string, salt: string): boolean` (parity with what firmware does; also used in tests)
  - `const DEVICE_SETTINGS_DEFAULTS: DeviceSettings`

- [ ] **Step 1: Write the failing test**

```ts
// lib/device-settings.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeDeviceSettings,
  hashSettingsPassword,
  verifySettingsPassword,
  DEVICE_SETTINGS_DEFAULTS,
} from "./device-settings";

describe("normalizeDeviceSettings", () => {
  it("returns defaults for empty / garbage input", () => {
    expect(normalizeDeviceSettings(undefined)).toEqual(DEVICE_SETTINGS_DEFAULTS);
    expect(normalizeDeviceSettings({})).toEqual(DEVICE_SETTINGS_DEFAULTS);
    expect(normalizeDeviceSettings("nope")).toEqual(DEVICE_SETTINGS_DEFAULTS);
  });

  it("clamps each field to its authoritative range", () => {
    expect(normalizeDeviceSettings({ qrVisibleSeconds: 5 }).qrVisibleSeconds).toBe(15);
    expect(normalizeDeviceSettings({ qrVisibleSeconds: 999 }).qrVisibleSeconds).toBe(180);
    expect(normalizeDeviceSettings({ screenBrightness: 0 }).screenBrightness).toBe(10);
    expect(normalizeDeviceSettings({ screenBrightness: 250 }).screenBrightness).toBe(100);
    expect(normalizeDeviceSettings({ screenSleepTimeoutSeconds: 1 }).screenSleepTimeoutSeconds).toBe(30);
    expect(normalizeDeviceSettings({ screenSleepTimeoutSeconds: 99999 }).screenSleepTimeoutSeconds).toBe(3600);
  });

  it("rounds floats and coerces the boolean", () => {
    const r = normalizeDeviceSettings({ screenBrightness: 55.7, screenSleepEnabled: true });
    expect(r.screenBrightness).toBe(56);
    expect(r.screenSleepEnabled).toBe(true);
  });
});

describe("settings password hashing", () => {
  it("produces a different salt each call but verifies correctly", () => {
    const a = hashSettingsPassword("1234");
    const b = hashSettingsPassword("1234");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(verifySettingsPassword("1234", a.hash, a.salt)).toBe(true);
    expect(verifySettingsPassword("0000", a.hash, a.salt)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- device-settings`
Expected: FAIL — "Cannot find module './device-settings'".

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/device-settings.ts
// Pure helpers for org-wide device policy settings: clamp/normalize numeric
// fields and hash the on-device Settings PIN. No IO — host-testable.

import { createHash, randomBytes } from "node:crypto";

export interface DeviceSettings {
  qrVisibleSeconds: number;
  screenBrightness: number;
  screenSleepEnabled: boolean;
  screenSleepTimeoutSeconds: number;
}

export const DEVICE_SETTINGS_DEFAULTS: DeviceSettings = {
  qrVisibleSeconds: 60,
  screenBrightness: 100,
  screenSleepEnabled: false,
  screenSleepTimeoutSeconds: 300,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export function normalizeDeviceSettings(input: unknown): DeviceSettings {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    qrVisibleSeconds: clamp(Math.round(num(r.qrVisibleSeconds, 60)), 15, 180),
    screenBrightness: clamp(Math.round(num(r.screenBrightness, 100)), 10, 100),
    screenSleepEnabled: typeof r.screenSleepEnabled === "boolean" ? r.screenSleepEnabled : false,
    screenSleepTimeoutSeconds: clamp(Math.round(num(r.screenSleepTimeoutSeconds, 300)), 30, 3600),
  };
}

export function hashSettingsPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return { hash, salt };
}

export function verifySettingsPassword(password: string, hash: string, salt: string): boolean {
  return createHash("sha256").update(salt + password).digest("hex") === hash;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- device-settings`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/device-settings.ts lib/device-settings.test.ts
git commit -m "feat: pure device-settings module (clamp + PIN hashing)"
```

---

### Task 2: Schema columns + migration

**Files:**
- Modify: `lib/db/schema.ts` (`tenantSettings`, lines 163–202; import line for `boolean`)

**Interfaces:**
- Produces six new `tenantSettings` columns consumed by Tasks 3–8:
  `qrVisibleSeconds` (int, default 60, NOT NULL), `screenBrightness` (int, default 100, NOT NULL), `screenSleepEnabled` (bool, default false, NOT NULL), `screenSleepTimeoutSeconds` (int, default 300, NOT NULL), `deviceSettingsPasswordHash` (text, nullable), `deviceSettingsPasswordSalt` (text, nullable).

- [ ] **Step 1: Ensure `boolean` is imported**

At the top of `lib/db/schema.ts`, confirm the `drizzle-orm/pg-core` import includes `boolean`. If absent, add it:

```ts
import { pgTable, text, integer, jsonb, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
```

(Match the existing import's exact member list; only add `boolean` if missing.)

- [ ] **Step 2: Add the columns**

In `tenantSettings`, immediately after the `staffPin` line (`staffPin: text("staff_pin"),`), insert:

```ts
  // --- Org-wide device policy settings (Device Settings page) -------------
  // QR visible duration. Source of truth for what was PrinterConfig.qrTimeoutSeconds;
  // overlaid back onto config.qrTimeoutSeconds at delivery (device contract unchanged).
  qrVisibleSeconds: integer("qr_visible_seconds").default(60).notNull(),
  // LCD backlight 10..100 (clamped so the screen can never go fully dark).
  screenBrightness: integer("screen_brightness").default(100).notNull(),
  // Screen sleep (display off, CPU keeps polling). false = stay awake.
  screenSleepEnabled: boolean("screen_sleep_enabled").default(false).notNull(),
  // Inactivity timeout before screen sleep, seconds (30..3600). Ignored when sleep off.
  screenSleepTimeoutSeconds: integer("screen_sleep_timeout_seconds").default(300).notNull(),
  // On-device Settings PIN: sha256(salt + pin). Device validates locally. null = ungated.
  deviceSettingsPasswordHash: text("device_settings_password_hash"),
  deviceSettingsPasswordSalt: text("device_settings_password_salt"),
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new file under `drizzle/` (or the project's migrations dir) adding the six columns with their defaults. Confirm the SQL only ADDs these columns and touches nothing else.

- [ ] **Step 4: Apply the migration**

Run: `npm run db:migrate`
Expected: applies cleanly to Neon. Then `npx tsc --noEmit` passes (the new columns are typed on `tenantSettings.$inferSelect`).

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat: device-settings columns on tenant_settings"
```

---

### Task 3: Extend the config ETag with the new settings

**Files:**
- Modify: `lib/device-config.ts` (`ConfigVersionInput` lines 9–17; `computeConfigVersion` lines 19–30)
- Test: `lib/device-config.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ConfigVersionInput` gains `qrVisibleSeconds: number`, `screenBrightness: number`, `screenSleepEnabled: boolean`, `screenSleepTimeoutSeconds: number`, `settingsPasswordHash: string | null`. `computeConfigVersion` hashes them so any change bumps the ETag. (Salt is omitted — the hash already changes whenever the password/salt changes.)

- [ ] **Step 1: Write the failing test**

Append to `lib/device-config.test.ts` (and update the shared `base` object):

```ts
// add to the `base` object:
//   qrVisibleSeconds: 60,
//   screenBrightness: 100,
//   screenSleepEnabled: false,
//   screenSleepTimeoutSeconds: 300,
//   settingsPasswordHash: null,

describe("computeConfigVersion — device settings", () => {
  it("changes when any device setting changes", () => {
    const v = computeConfigVersion(base);
    expect(computeConfigVersion({ ...base, qrVisibleSeconds: 90 })).not.toBe(v);
    expect(computeConfigVersion({ ...base, screenBrightness: 50 })).not.toBe(v);
    expect(computeConfigVersion({ ...base, screenSleepEnabled: true })).not.toBe(v);
    expect(computeConfigVersion({ ...base, screenSleepTimeoutSeconds: 600 })).not.toBe(v);
    expect(computeConfigVersion({ ...base, settingsPasswordHash: "abc" })).not.toBe(v);
  });
});
```

Update the existing `base` literal at the top of the file to include the five new keys shown above (otherwise TypeScript will error on the new required fields).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- device-config`
Expected: FAIL — type error / new keys not part of the hash.

- [ ] **Step 3: Update the implementation**

```ts
export interface ConfigVersionInput {
  printerScreens: unknown;
  printerLayout: unknown;
  logoUrl: string | null;
  brandColor: string | null;
  brandBg: string | null;
  brandFg: string | null;
  brandMuted: string | null;
  qrVisibleSeconds: number;
  screenBrightness: number;
  screenSleepEnabled: boolean;
  screenSleepTimeoutSeconds: number;
  settingsPasswordHash: string | null;
}

export function computeConfigVersion(input: ConfigVersionInput): string {
  const canonical = JSON.stringify([
    input.printerScreens ?? null,
    input.printerLayout ?? null,
    input.logoUrl ?? null,
    input.brandColor ?? null,
    input.brandBg ?? null,
    input.brandFg ?? null,
    input.brandMuted ?? null,
    input.qrVisibleSeconds,
    input.screenBrightness,
    input.screenSleepEnabled,
    input.screenSleepTimeoutSeconds,
    input.settingsPasswordHash ?? null,
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- device-config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/device-config.ts lib/device-config.test.ts
git commit -m "feat: include device settings in config ETag"
```

---

### Task 4: Data layer — payload, delivery overlay, and view-model reader

**Files:**
- Modify: `lib/data.ts` (`DeviceConfigPayload` ~838–846; `getDeviceConfig` ~853–918; `getTenantBranding` ~784–835; add `getTenantDeviceSettings`)

**Interfaces:**
- Consumes: `normalizeDeviceSettings` (Task 1), new columns (Task 2), extended `ConfigVersionInput` (Task 3).
- Produces:
  - `DeviceConfigPayload.device: { brightness: number; sleep: { enabled: boolean; timeoutSeconds: number }; settingsPasswordHash: string | null; settingsPasswordSalt: string | null }`
  - `interface TenantDeviceSettings { qrVisibleSeconds: number; screenBrightness: number; screenSleepEnabled: boolean; screenSleepTimeoutSeconds: number; hasPassword: boolean }`
  - `function getTenantDeviceSettings(organizationId: string): Promise<TenantDeviceSettings>`

This task mirrors existing DB functions in `lib/data.ts`, which the repo does not unit-test (only pure modules have `.test.ts`). Verification is `tsc` + the build + the manual smoke test at the end.

- [ ] **Step 1: Import the normalizer**

At the top of `lib/data.ts`, add to the existing imports:

```ts
import { normalizeDeviceSettings } from "@/lib/device-settings";
```

- [ ] **Step 2: Extend `DeviceConfigPayload`**

```ts
export interface DeviceConfigPayload {
  version: string;
  brandColor: string;
  brandBg: string;
  brandFg: string;
  brandMuted: string;
  logoUrl: string | null; // presigned, short-lived
  config: PrinterConfig; // uploaded icon keys presigned for rendering
  device: {
    brightness: number; // 10..100
    sleep: { enabled: boolean; timeoutSeconds: number };
    settingsPasswordHash: string | null;
    settingsPasswordSalt: string | null;
  };
}
```

- [ ] **Step 3: Feed the new fields into `getDeviceConfig`**

In `getDeviceConfig`, replace the `computeConfigVersion({...})` call so it includes the device-settings columns, then overlay QR duration and add the `device` block to the returned payload. Compute a normalized settings object once:

```ts
  const ds = normalizeDeviceSettings({
    qrVisibleSeconds: s?.qrVisibleSeconds,
    screenBrightness: s?.screenBrightness,
    screenSleepEnabled: s?.screenSleepEnabled,
    screenSleepTimeoutSeconds: s?.screenSleepTimeoutSeconds,
  });

  const version = computeConfigVersion({
    printerScreens: s?.printerScreens ?? null,
    printerLayout: s?.printerLayout ?? null,
    logoUrl: s?.logoUrl ?? null,
    brandColor: s?.brandColor ?? null,
    brandBg: s?.brandBg ?? null,
    brandFg: s?.brandFg ?? null,
    brandMuted: s?.brandMuted ?? null,
    qrVisibleSeconds: ds.qrVisibleSeconds,
    screenBrightness: ds.screenBrightness,
    screenSleepEnabled: ds.screenSleepEnabled,
    screenSleepTimeoutSeconds: ds.screenSleepTimeoutSeconds,
    settingsPasswordHash: s?.deviceSettingsPasswordHash ?? null,
  });
```

After `const config = normalizePrinterConfig(...)` and before the return, overlay QR duration so the firmware keeps reading `config.qrTimeoutSeconds`:

```ts
  // QR duration's source of truth is now the qrVisibleSeconds column; overlay it.
  config.qrTimeoutSeconds = ds.qrVisibleSeconds;
```

Then add `device` to the returned `payload`:

```ts
      device: {
        brightness: ds.screenBrightness,
        sleep: { enabled: ds.screenSleepEnabled, timeoutSeconds: ds.screenSleepTimeoutSeconds },
        settingsPasswordHash: s?.deviceSettingsPasswordHash ?? null,
        settingsPasswordSalt: s?.deviceSettingsPasswordSalt ?? null,
      },
```

- [ ] **Step 4: Overlay QR duration in `getTenantBranding` (so the editor preview shows the canonical value)**

In `getTenantBranding`, after `const config = normalizePrinterConfig(s?.printerScreens ?? s?.printerLayout);`, add:

```ts
  // QR duration is owned by the Device Settings page (qrVisibleSeconds column).
  // Overlay it so the Branding preview's countdown reflects the canonical value.
  config.qrTimeoutSeconds = normalizeDeviceSettings({ qrVisibleSeconds: s?.qrVisibleSeconds }).qrVisibleSeconds;
```

- [ ] **Step 5: Add `getTenantDeviceSettings`**

Place it next to `getTenantBranding` in `lib/data.ts`:

```ts
export interface TenantDeviceSettings {
  qrVisibleSeconds: number;
  screenBrightness: number;
  screenSleepEnabled: boolean;
  screenSleepTimeoutSeconds: number;
  hasPassword: boolean;
}

/** View model for the tenant Device Settings page. Never exposes the PIN hash. */
export async function getTenantDeviceSettings(
  organizationId: string,
): Promise<TenantDeviceSettings> {
  const [s] = await db
    .select({
      qrVisibleSeconds: settingsTable.qrVisibleSeconds,
      screenBrightness: settingsTable.screenBrightness,
      screenSleepEnabled: settingsTable.screenSleepEnabled,
      screenSleepTimeoutSeconds: settingsTable.screenSleepTimeoutSeconds,
      deviceSettingsPasswordHash: settingsTable.deviceSettingsPasswordHash,
    })
    .from(settingsTable)
    .where(eq(settingsTable.organizationId, organizationId))
    .limit(1);

  const ds = normalizeDeviceSettings({
    qrVisibleSeconds: s?.qrVisibleSeconds,
    screenBrightness: s?.screenBrightness,
    screenSleepEnabled: s?.screenSleepEnabled,
    screenSleepTimeoutSeconds: s?.screenSleepTimeoutSeconds,
  });
  return { ...ds, hasPassword: !!s?.deviceSettingsPasswordHash };
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/data.ts
git commit -m "feat: deliver device settings in config payload + view-model reader"
```

---

### Task 5: Server action, page, audit constant, and nav

**Files:**
- Create: `app/(tenant)/tenant/device-settings/actions.ts`
- Create: `app/(tenant)/tenant/device-settings/page.tsx`
- Modify: `lib/audit.ts` (`AUDIT` object)
- Modify: `lib/nav.ts` (imports + `TENANT_NAV`)

**Interfaces:**
- Consumes: `getTenantDeviceSettings` (Task 4), `normalizeDeviceSettings`/`hashSettingsPassword` (Task 1), `enqueueConfigChangedForOrg` (existing), `requireTenant`/`recordAudit`/`AUDIT` (existing). The client form (Task 6) is referenced here but built next; create the page importing it.
- Produces: `interface SaveDeviceSettingsResult { ok: boolean; error?: string }`; `async function saveDeviceSettings(formData: FormData): Promise<SaveDeviceSettingsResult>`.

- [ ] **Step 1: Add the audit constant**

In `lib/audit.ts`, add to the `AUDIT` object (e.g. after `brandingUpdated`):

```ts
  deviceSettingsUpdated: "device_settings.updated",
```

- [ ] **Step 2: Write the server action**

```ts
// app/(tenant)/tenant/device-settings/actions.ts
"use server";

// Persist org-wide device policy settings to tenant_settings. Owners/admins only.
// On save, nudges every device in the org to re-pull GET /api/device/config.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { requireTenant } from "@/lib/session";
import { normalizeDeviceSettings, hashSettingsPassword } from "@/lib/device-settings";
import { recordAudit, AUDIT } from "@/lib/audit";
import { enqueueConfigChangedForOrg } from "@/lib/data";

export interface SaveDeviceSettingsResult {
  ok: boolean;
  error?: string;
}

export async function saveDeviceSettings(
  formData: FormData,
): Promise<SaveDeviceSettingsResult> {
  const { ctx, organizationId } = await requireTenant();

  const membership = ctx.organizations.find((o) => o.id === organizationId);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "You don't have permission to edit device settings." };
  }

  const num = (k: string) => Number(formData.get(k));
  const ds = normalizeDeviceSettings({
    qrVisibleSeconds: num("qrVisibleSeconds"),
    screenBrightness: num("screenBrightness"),
    screenSleepEnabled: formData.get("screenSleepEnabled") === "true",
    screenSleepTimeoutSeconds: num("screenSleepTimeoutSeconds"),
  });

  // Password: clear / set / leave unchanged.
  const clearPassword = formData.get("clearPassword") === "true";
  const newPassword = String(formData.get("password") ?? "").trim();
  let passwordUpdate: {
    deviceSettingsPasswordHash?: string | null;
    deviceSettingsPasswordSalt?: string | null;
  } = {};
  if (clearPassword) {
    passwordUpdate = { deviceSettingsPasswordHash: null, deviceSettingsPasswordSalt: null };
  } else if (newPassword) {
    if (!/^[0-9]{4,12}$/.test(newPassword)) {
      return { ok: false, error: "PIN must be 4–12 digits." };
    }
    const { hash, salt } = hashSettingsPassword(newPassword);
    passwordUpdate = { deviceSettingsPasswordHash: hash, deviceSettingsPasswordSalt: salt };
  }

  const now = new Date();
  await db
    .insert(tenantSettings)
    .values({ organizationId, ...ds, ...passwordUpdate })
    .onConflictDoUpdate({
      target: tenantSettings.organizationId,
      set: { ...ds, ...passwordUpdate, updatedAt: now },
    });

  await recordAudit({
    organizationId,
    actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    action: AUDIT.deviceSettingsUpdated,
  });

  revalidatePath("/tenant/device-settings");

  // Nudge devices to re-pull config. Best-effort: they also reconcile via ETag.
  try {
    await enqueueConfigChangedForOrg(organizationId, ctx.user.id);
  } catch (err) {
    console.error("config-changed enqueue failed (devices reconcile on next poll)", err);
  }

  return { ok: true };
}
```

- [ ] **Step 3: Write the page (server component)**

```tsx
// app/(tenant)/tenant/device-settings/page.tsx
import { PageHeader } from "@/components/page-header";
import { DeviceSettingsForm } from "@/components/device-settings-form";
import { getTenantDeviceSettings } from "@/lib/data";
import { requireTenant } from "@/lib/session";

export default async function DeviceSettingsPage() {
  const { ctx, organizationId } = await requireTenant();
  const settings = await getTenantDeviceSettings(organizationId);

  const membership = ctx.organizations.find((o) => o.id === organizationId);
  const canEdit = !!membership && ["owner", "admin"].includes(membership.role);

  return (
    <>
      <PageHeader
        title="Device Settings"
        description="Policies applied to every device in your organization. Devices update automatically."
      />
      <DeviceSettingsForm initial={settings} canEdit={canEdit} />
    </>
  );
}
```

- [ ] **Step 4: Add the nav item**

In `lib/nav.ts`, add `MonitorCog` to the lucide import list, then insert into `TENANT_NAV` immediately after the Branding entry:

```ts
  { label: "Device Settings", href: "/tenant/device-settings", icon: MonitorCog },
```

- [ ] **Step 5: Typecheck (form not built yet — expect one known error)**

Run: `npx tsc --noEmit`
Expected: only an unresolved-module error for `@/components/device-settings-form` (built in Task 6). Everything else clean. Do not commit yet; finish Task 6 first so the commit builds.

---

### Task 6: Client form component

**Files:**
- Create: `components/device-settings-form.tsx`

**Interfaces:**
- Consumes: `saveDeviceSettings` (Task 5), `TenantDeviceSettings` (Task 4), shadcn `Slider`/`Switch`/`Select`/`Input`/`Label`/`Button`/`Card`, `toast` from sonner.
- Produces: `function DeviceSettingsForm({ initial, canEdit }: { initial: TenantDeviceSettings; canEdit: boolean })`.

- [ ] **Step 1: Write the component**

```tsx
// components/device-settings-form.tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { saveDeviceSettings } from "@/app/(tenant)/tenant/device-settings/actions";
import type { TenantDeviceSettings } from "@/lib/data";

const SLEEP_TIMEOUT_OPTIONS = [
  { label: "30 seconds", value: 30 },
  { label: "1 minute", value: 60 },
  { label: "2 minutes", value: 120 },
  { label: "5 minutes", value: 300 },
  { label: "10 minutes", value: 600 },
  { label: "15 minutes", value: 900 },
  { label: "30 minutes", value: 1800 },
  { label: "60 minutes", value: 3600 },
];

export function DeviceSettingsForm({
  initial,
  canEdit,
}: {
  initial: TenantDeviceSettings;
  canEdit: boolean;
}) {
  const [qr, setQr] = React.useState(initial.qrVisibleSeconds);
  const [brightness, setBrightness] = React.useState(initial.screenBrightness);
  const [sleepEnabled, setSleepEnabled] = React.useState(initial.screenSleepEnabled);
  const [sleepTimeout, setSleepTimeout] = React.useState(initial.screenSleepTimeoutSeconds);
  const [password, setPassword] = React.useState("");
  const [clearPassword, setClearPassword] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const disabled = !canEdit || saving;

  const dirty =
    qr !== initial.qrVisibleSeconds ||
    brightness !== initial.screenBrightness ||
    sleepEnabled !== initial.screenSleepEnabled ||
    sleepTimeout !== initial.screenSleepTimeoutSeconds ||
    password.length > 0 ||
    clearPassword;

  function reset() {
    setQr(initial.qrVisibleSeconds);
    setBrightness(initial.screenBrightness);
    setSleepEnabled(initial.screenSleepEnabled);
    setSleepTimeout(initial.screenSleepTimeoutSeconds);
    setPassword("");
    setClearPassword(false);
  }

  async function save() {
    if (password && !/^[0-9]{4,12}$/.test(password.trim())) {
      toast.error("PIN must be 4–12 digits.");
      return;
    }
    setSaving(true);
    const fd = new FormData();
    fd.set("qrVisibleSeconds", String(qr));
    fd.set("screenBrightness", String(brightness));
    fd.set("screenSleepEnabled", String(sleepEnabled));
    fd.set("screenSleepTimeoutSeconds", String(sleepTimeout));
    if (clearPassword) fd.set("clearPassword", "true");
    else if (password) fd.set("password", password.trim());

    const res = await saveDeviceSettings(fd);
    setSaving(false);
    if (res.ok) {
      toast.success("Device settings saved. Devices will update on next check-in.");
      // Reflect saved state locally without a full reload.
      window.location.reload();
    } else {
      toast.error(res.error ?? "Couldn't save device settings.");
    }
  }

  const hasPassword = initial.hasPassword && !clearPassword;

  return (
    <div className="space-y-6 pb-24">
      {/* QR visible duration */}
      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <Label>QR code visible for</Label>
          <span className="text-sm tabular-nums text-muted-foreground">{qr}s</span>
        </div>
        <Slider
          min={15}
          max={180}
          step={5}
          value={[qr]}
          onValueChange={([v]) => setQr(v)}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          How long the receipt QR code stays on screen before the device returns to idle (15–180s).
        </p>
      </Card>

      {/* Brightness */}
      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <Label>Screen brightness</Label>
          <span className="text-sm tabular-nums text-muted-foreground">{brightness}%</span>
        </div>
        <Slider
          min={10}
          max={100}
          step={1}
          value={[brightness]}
          onValueChange={([v]) => setBrightness(v)}
          disabled={disabled}
        />
      </Card>

      {/* Sleep */}
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label>Screen sleep</Label>
            <p className="text-xs text-muted-foreground">
              Turn the display off after inactivity. The device stays online and wakes on touch
              or when a new receipt prints.
            </p>
          </div>
          <Switch checked={sleepEnabled} onCheckedChange={setSleepEnabled} disabled={disabled} />
        </div>
        {sleepEnabled && (
          <div className="flex items-center justify-between gap-4">
            <Label className="text-sm font-normal text-muted-foreground">Sleep after</Label>
            <Select
              value={String(sleepTimeout)}
              onValueChange={(v) => setSleepTimeout(Number(v))}
              disabled={disabled}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SLEEP_TIMEOUT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </Card>

      {/* Settings PIN */}
      <Card className="space-y-3 p-5">
        <Label>Device Settings PIN</Label>
        <p className="text-xs text-muted-foreground">
          {hasPassword
            ? "A PIN is set. Enter a new one to change it, or remove it to leave the on-device Settings page unlocked."
            : "Set a 4–12 digit PIN to lock the device's on-screen Settings page. Leave blank to keep it unlocked."}
        </p>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder={hasPassword ? "Enter new PIN to change" : "Set a PIN"}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (e.target.value) setClearPassword(false);
          }}
          disabled={disabled || clearPassword}
        />
        {initial.hasPassword && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={clearPassword}
              onChange={(e) => {
                setClearPassword(e.target.checked);
                if (e.target.checked) setPassword("");
              }}
              disabled={disabled}
            />
            Remove PIN (leave Settings page unlocked)
          </label>
        )}
      </Card>

      {/* Sticky save bar (mirrors Branding) */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-6 py-3 backdrop-blur sm:left-[var(--sidebar-width,0)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className={cn("size-2 rounded-full", dirty ? "bg-amber-500" : "bg-emerald-500")} />
            {!canEdit ? "Read only" : dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={reset} disabled={disabled || !dirty}>
              Reset
            </Button>
            <Button onClick={save} disabled={disabled || !dirty}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

> Note: if the `Switch`'s change prop is named differently in this repo's wrapper, match `components/ui/switch.tsx` (radix/base-ui `onCheckedChange` is standard). The sticky-bar `--sidebar-width` offset is cosmetic — if that CSS var isn't defined app-wide, drop the `sm:left-[...]` and keep `inset-x-0`.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. The Task 5 page now resolves the import.

- [ ] **Step 3: Commit (Tasks 5 + 6 together — the page needs the form to build)**

```bash
git add app/\(tenant\)/tenant/device-settings/ components/device-settings-form.tsx lib/audit.ts lib/nav.ts
git commit -m "feat: Device Settings page, action, and form"
```

---

### Task 7: Remove the QR-duration control from the Branding editor

**Files:**
- Modify: `components/device-preview/printer-editor/printer-controls.tsx` (countdown property panel, ~lines 249–265)

**Interfaces:**
- Consumes: nothing new. After Task 4, `config.qrTimeoutSeconds` is fed from the `qrVisibleSeconds` column for both delivery and preview, so the editor must no longer edit it.

- [ ] **Step 1: Inspect the countdown panel**

Run: `sed -n '245,270p' components/device-preview/printer-editor/printer-controls.tsx`
Expected: a block `{object.type === "countdown" && ( ... )}` containing an input bound to `editor.config.qrTimeoutSeconds` calling `editor.setShared({ qrTimeoutSeconds: ... })`.

- [ ] **Step 2: Replace the editable control with a read-only note**

Replace the `{object.type === "countdown" && ( ... )}` block with a static, non-editable hint that points the user to Device Settings (keep the countdown object itself selectable/movable; only the duration field moves):

```tsx
      {object.type === "countdown" && (
        <p className="text-xs text-muted-foreground">
          The QR code's visible duration is set in <span className="font-medium">Device Settings</span>.
        </p>
      )}
```

Leave `setShared` and the `qrTimeoutSeconds` field on the `PrinterConfig` type intact — the editor still receives the value (overlaid by `getTenantBranding`) and renders the countdown preview with it; it simply can no longer change it. (The branding save still writes `qrTimeoutSeconds` into the JSON, but `getDeviceConfig`/`getTenantBranding` overlay the column, so the column is authoritative.)

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean (no remaining references to the removed input).

- [ ] **Step 4: Commit**

```bash
git add components/device-preview/printer-editor/printer-controls.tsx
git commit -m "refactor: move QR duration control to Device Settings"
```

---

### Task 8: Backfill `qrVisibleSeconds` from existing printer config

**Files:**
- Create: `lib/db/backfill-qr-visible.ts`

**Interfaces:**
- Consumes: `normalizePrinterConfig` (existing), `normalizeDeviceSettings` (Task 1), the DB client.
- Produces: a one-shot script (run via `tsx`) that copies each org's current `printerScreens.qrTimeoutSeconds` (or legacy `printerLayout`) into the new `qrVisibleSeconds` column. Idempotent.

- [ ] **Step 1: Write the script**

```ts
// lib/db/backfill-qr-visible.ts
// One-time: copy each org's existing printer-config QR timeout into the new
// qrVisibleSeconds column (default 60 if absent). Idempotent. Run with:
//   npx tsx lib/db/backfill-qr-visible.ts
import "./load-env";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { normalizePrinterConfig } from "@/lib/printer-layout";
import { normalizeDeviceSettings } from "@/lib/device-settings";

async function main() {
  const rows = await db
    .select({
      organizationId: tenantSettings.organizationId,
      printerScreens: tenantSettings.printerScreens,
      printerLayout: tenantSettings.printerLayout,
    })
    .from(tenantSettings);

  let updated = 0;
  for (const r of rows) {
    const cfg = normalizePrinterConfig(r.printerScreens ?? r.printerLayout);
    const qr = normalizeDeviceSettings({ qrVisibleSeconds: cfg.qrTimeoutSeconds }).qrVisibleSeconds;
    await db
      .update(tenantSettings)
      .set({ qrVisibleSeconds: qr })
      .where(eq(tenantSettings.organizationId, r.organizationId));
    updated++;
  }
  console.log(`Backfilled qrVisibleSeconds for ${updated} org(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the backfill**

Run: `npx tsx lib/db/backfill-qr-visible.ts`
Expected: `Backfilled qrVisibleSeconds for N org(s).` (N ≥ 1; Roastwell seed org included).

- [ ] **Step 3: Verify in Studio (optional)**

Run: `npm run db:studio` → open `tenant_settings`, confirm `qr_visible_seconds` matches each org's previously-configured countdown.

- [ ] **Step 4: Commit**

```bash
git add lib/db/backfill-qr-visible.ts
git commit -m "chore: backfill qrVisibleSeconds from printer config"
```

---

### Task 9: End-to-end smoke test

**Files:** none (manual verification).

- [ ] **Step 1: Run the dev server**

Run: `npm run dev`, sign in as `dana@roastwell.co` / `123456`.

- [ ] **Step 2: Verify the page**

- "Device Settings" appears in the tenant sidebar directly under "Branding".
- Open it: QR slider reflects the backfilled value, brightness 100%, sleep off, PIN shows "set" only if one exists.

- [ ] **Step 3: Verify save + propagation**

- Change brightness, enable sleep (pick 5 minutes), set a PIN (e.g. `4821`), Save → success toast.
- Reopen: brightness/sleep persisted; the form shows "A PIN is set"; the PIN field is blank (hash never returned).

- [ ] **Step 4: Verify the device payload**

Run (replace `<KEY>` with a claimed device's key — see seed/Studio):
```bash
curl -s -H "Authorization: Bearer <KEY>" http://localhost:3000/api/device/config | python3 -m json.tool
```
Expected JSON includes a `device` block (`brightness`, `sleep.enabled`, `sleep.timeoutSeconds`, `settingsPasswordHash`, `settingsPasswordSalt`) and `config.qrTimeoutSeconds` equals the value set on the Device Settings page. Re-running with `-H 'If-None-Match: "<etag>"'` (the ETag from the response headers; use `-i`) returns `304`.

- [ ] **Step 5: Verify a config-changed command was enqueued**

In `npm run db:studio` → `device_command`, confirm one `config-changed` row per org device was created at save time.

---

## Self-Review

**Spec coverage:**
- QR visible duration → Tasks 2 (column), 4 (overlay), 6 (slider), 7 (remove old control), 8 (backfill). ✓
- Screen brightness → Tasks 2, 4, 6. ✓
- Sleep on/off + timeout → Tasks 2, 4, 6 (screen-sleep semantics documented in form copy). ✓
- Settings password (salted SHA-256, hash never returned, device validates locally) → Tasks 1, 4, 5, 6. ✓
- Apply to all devices automatically → Task 5 (`enqueueConfigChangedForOrg`) + Task 3 (ETag bump). ✓
- Nav under Branding → Task 5. ✓
- ETag versioning of new fields → Task 3. ✓
- Validation ranges → Task 1 (single source of clamping, reused by action + data layer). ✓
- Firmware (separate maratus-firmware milestone) → out of scope here; contract delivered via Task 4 payload. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. The only deliberate "known error" is Task 5 Step 5 (form not yet built), resolved in Task 6 and committed together.

**Type consistency:** `normalizeDeviceSettings`/`DeviceSettings` (Task 1) used identically in Tasks 4/5/8. `ConfigVersionInput` new fields (Task 3) match the call site in Task 4. `TenantDeviceSettings` (Task 4) consumed by the page (Task 5) and form (Task 6). `saveDeviceSettings` signature matches the form's `FormData` keys. Column names in schema (Task 2) match every reader/writer.

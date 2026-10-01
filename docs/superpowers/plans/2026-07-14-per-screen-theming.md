# Per-Screen Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each of the 7 printer screens can optionally override the tenant's global 4-color palette (accent/bg/fg/muted); screens without an override keep inheriting the global palette.

**Architecture:** The override lives inside the existing `printerScreens` jsonb, on each screen entry (`screens[s].colors`, all-or-nothing 4 valid hex colors). `normalizePrinterConfig` validates/drops it; the preview overlays it onto the global brand when computing root CSS variables (object renderers untouched); the Theme tab gains a per-active-screen override section with an on/off switch. The device payload carries it automatically (config ships verbatim; old firmware ignores unknown fields; ETag is keyed on the stored config so devices re-fetch).

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict, vitest, shadcn (radix-nova) `Switch`, existing `ColorField`/`derivePalettes` in the studio.

**Spec:** `docs/superpowers/specs/2026-07-14-per-screen-theming-design.md`

## Global Constraints

- No DB migration, no API route changes, no new dependencies.
- Override is **all-or-nothing**: `colors` present ⇒ all four of `accent, bg, fg, muted` are valid 6-digit hex (accepted with or without `#`, normalized to lowercase `#`-prefixed). Anything else ⇒ the field is dropped (screen inherits global). Never throw.
- `migrateV2ToConfig` and `seededScreen` must never produce `colors`.
- Do NOT run `npm run db:*` or touch `.env.local` (it points at PROD).
- All commits on `main`, message style `feat(branding): …` / `test: …`, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Data model, normalize, and `screenColors()` reader

**Files:**
- Modify: `lib/printer-layout.ts`
- Test: `lib/printer-layout.test.ts`

**Interfaces:**
- Consumes: existing `PrinterConfig`, `ScreenLayout`, `sanitizeScreen`, `normalizePrinterConfig` in `lib/printer-layout.ts`.
- Produces (later tasks rely on these exact names):
  - `export interface ScreenColors { accent: string; bg: string; fg: string; muted: string }`
  - `ScreenLayout.colors?: ScreenColors`
  - `export function screenColors(config: PrinterConfig, screen: PrinterScreen): ScreenColors | null`

- [ ] **Step 1: Write the failing tests**

Append to `lib/printer-layout.test.ts`:

```ts
// ─── Per-screen color overrides ──────────────────────────────────────────────

import { screenColors, type ScreenColors } from "./printer-layout";

describe("per-screen colors", () => {
  const base = { version: 3, clockTimezone: "UTC", clock24h: false, wifiLevel: 3, qrTimeoutSeconds: 60 };
  const idleWith = (colors: unknown) => normalizePrinterConfig({
    ...base,
    screens: { idle: { objects: [
      { id: "t", type: "text", x: 0.1, y: 0.1, w: 0.3, h: 0.1, visible: true, z: 0, text: "hi" },
    ], colors } },
  });

  it("keeps a valid 4-color override and normalizes hex to #-prefixed lowercase", () => {
    const cfg = idleWith({ accent: "10A765", bg: "#FFFFFF", fg: "#111111", muted: "#8a8a8a" });
    expect(cfg.screens.idle.colors).toEqual({
      accent: "#10a765", bg: "#ffffff", fg: "#111111", muted: "#8a8a8a",
    });
  });

  it("drops partial, invalid-hex, and non-object overrides", () => {
    expect(idleWith({ accent: "#10a765", bg: "#ffffff", fg: "#111111" }).screens.idle.colors).toBeUndefined();
    expect(idleWith({ accent: "#10a765", bg: "#ffffff", fg: "#111111", muted: "nope" }).screens.idle.colors).toBeUndefined();
    expect(idleWith({ accent: "#10a765", bg: "#ffffff", fg: "#111111", muted: "#abc" }).screens.idle.colors).toBeUndefined(); // 3-digit rejected
    expect(idleWith("dark").screens.idle.colors).toBeUndefined();
    expect(idleWith(null).screens.idle.colors).toBeUndefined();
  });

  it("v2 migration and seeded screens never produce colors", () => {
    const migrated = normalizePrinterConfig(defaultLayout());
    for (const s of PRINTER_SCREENS) {
      expect(migrated.screens[s].colors).toBeUndefined();
      expect(seededScreen(s).colors).toBeUndefined();
    }
  });

  it("screenColors returns the override when present, null otherwise", () => {
    const cfg = idleWith({ accent: "#10a765", bg: "#ffffff", fg: "#111111", muted: "#8a8a8a" });
    expect(screenColors(cfg, "idle")).toEqual({ accent: "#10a765", bg: "#ffffff", fg: "#111111", muted: "#8a8a8a" });
    expect(screenColors(cfg, "error")).toBeNull();
  });

  it("round-trips: a normalized override survives re-normalization", () => {
    const once = idleWith({ accent: "#10a765", bg: "#ffffff", fg: "#111111", muted: "#8a8a8a" });
    const twice = normalizePrinterConfig(once);
    expect(twice.screens.idle.colors).toEqual(once.screens.idle.colors);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/printer-layout.test.ts`
Expected: FAIL — `screenColors` has no exported member / `colors` property does not exist.

- [ ] **Step 3: Implement in `lib/printer-layout.ts`**

3a. Extend `ScreenLayout` (currently `{ objects: PrinterObject[] }`) and add the type:

```ts
/** All-or-nothing per-screen palette override; absent = inherit the global palette. */
export interface ScreenColors {
  accent: string; // #rrggbb
  bg: string;
  fg: string;
  muted: string;
}

export interface ScreenLayout {
  objects: PrinterObject[];
  colors?: ScreenColors;
}
```

3b. Below `sanitizeClock`, add the validator (6-digit hex only — the color inputs
always emit `#rrggbb`, and the firmware contract stays unambiguous):

```ts
const HEX6 = /^#?([0-9a-f]{6})$/i;

/** Valid = all four tokens are 6-digit hex; normalized to #-prefixed lowercase. Else null. */
function sanitizeScreenColors(raw: unknown): ScreenColors | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: Partial<ScreenColors> = {};
  for (const key of ["accent", "bg", "fg", "muted"] as const) {
    const m = typeof r[key] === "string" ? (r[key] as string).match(HEX6) : null;
    if (!m) return null;
    out[key] = `#${m[1].toLowerCase()}`;
  }
  return out as ScreenColors;
}
```

3c. In `sanitizeScreen`, attach the override to the returned layout. The current
last line is:

```ts
  // If a screen was emptied to nothing, fall back to its seed so it isn't blank.
  return { objects: out.length ? out : seededScreen(screen).objects };
```

Replace with:

```ts
  const colors = sanitizeScreenColors((r as { colors?: unknown }).colors);
  // If a screen was emptied to nothing, fall back to its seed so it isn't blank.
  return {
    objects: out.length ? out : seededScreen(screen).objects,
    ...(colors ? { colors } : {}),
  };
```

(`r` is already destructured at the top of `sanitizeScreen` as `{ objects?: unknown }`;
widen that annotation to `{ objects?: unknown; colors?: unknown }`.)

3d. Add the reader next to `objectLabel`:

```ts
/** The screen's palette override, or null to use the global palette. */
export function screenColors(config: PrinterConfig, screen: PrinterScreen): ScreenColors | null {
  return config.screens[screen].colors ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/printer-layout.test.ts`
Expected: PASS (all, including the 41 pre-existing).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: exit 0.

```bash
git add lib/printer-layout.ts lib/printer-layout.test.ts
git commit -m "feat(branding): per-screen ScreenColors in config model + normalize + screenColors()

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Pure screen updaters + editor hook wiring (colors-preserving `setObjects`, `setScreenColors`)

**Files:**
- Modify: `lib/printer-layout.ts`
- Modify: `components/device-preview/printer-editor/use-printer-editor.ts`
- Test: `lib/printer-layout.test.ts`

**Interfaces:**
- Consumes: `ScreenColors`, `ScreenLayout` from Task 1.
- Produces:
  - `export function withScreenObjects(config: PrinterConfig, screen: PrinterScreen, objects: PrinterObject[]): PrinterConfig` — replaces a screen's objects, **preserving** its `colors`.
  - `export function withScreenColors(config: PrinterConfig, screen: PrinterScreen, colors: ScreenColors | null): PrinterConfig` — sets or (on `null`) removes the override, preserving objects.
  - `PrinterEditor.setScreenColors(c: ScreenColors | null): void` (UI reads the current override via `editor.config.screens[editor.screen].colors`).

- [ ] **Step 1: Write the failing tests**

Append to `lib/printer-layout.test.ts`:

```ts
import { withScreenObjects, withScreenColors, createTextObject as mkText } from "./printer-layout";

describe("screen updaters", () => {
  const colors: ScreenColors = { accent: "#10a765", bg: "#ffffff", fg: "#111111", muted: "#8a8a8a" };
  const cfg = () => {
    const c = normalizePrinterConfig(null);
    return withScreenColors(c, "idle", colors);
  };

  it("withScreenColors sets and removes the override without touching objects", () => {
    const withC = cfg();
    expect(withC.screens.idle.colors).toEqual(colors);
    expect(withC.screens.idle.objects.length).toBeGreaterThan(0);
    const removed = withScreenColors(withC, "idle", null);
    expect(removed.screens.idle.colors).toBeUndefined();
    expect("colors" in removed.screens.idle).toBe(false); // key absent, not undefined (clean JSON)
    expect(removed.screens.idle.objects).toEqual(withC.screens.idle.objects);
  });

  it("withScreenObjects replaces objects and PRESERVES the color override", () => {
    const next = withScreenObjects(cfg(), "idle", [mkText("hello", 0)]);
    expect(next.screens.idle.objects.map((o) => o.text)).toEqual(["hello"]);
    expect(next.screens.idle.colors).toEqual(colors);
  });

  it("updaters do not mutate their input and leave other screens alone", () => {
    const before = cfg();
    const snapshot = JSON.stringify(before);
    const after = withScreenObjects(before, "idle", []);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after.screens.error).toBe(before.screens.error);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/printer-layout.test.ts`
Expected: FAIL — `withScreenObjects` / `withScreenColors` not exported.

- [ ] **Step 3: Implement the pure updaters in `lib/printer-layout.ts`**

Add below `screenColors`:

```ts
/** Replace one screen's objects, preserving its other fields (e.g. colors). */
export function withScreenObjects(
  config: PrinterConfig,
  screen: PrinterScreen,
  objects: PrinterObject[],
): PrinterConfig {
  return {
    ...config,
    screens: { ...config.screens, [screen]: { ...config.screens[screen], objects } },
  };
}

/** Set (or remove, with null) one screen's palette override, preserving its objects. */
export function withScreenColors(
  config: PrinterConfig,
  screen: PrinterScreen,
  colors: ScreenColors | null,
): PrinterConfig {
  const entry = config.screens[screen];
  const next: ScreenLayout = colors
    ? { ...entry, colors }
    : { objects: entry.objects }; // rebuild without the key so JSON stays clean
  return { ...config, screens: { ...config.screens, [screen]: next } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/printer-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the editor hook**

In `components/device-preview/printer-editor/use-printer-editor.ts`:

5a. Import the updaters (extend the existing `@/lib/printer-layout` import):

```ts
import {
  createTextObject,
  createImageObject,
  createClockObject,
  createWifiObject,
  seededScreen,
  withScreenObjects,
  withScreenColors,
  MAX_CUSTOM,
  type PrinterObject,
  type PrinterConfig,
  type PrinterScreen,
  type ScreenColors,
} from "@/lib/printer-layout";
```

5b. Replace `setObjects` (currently builds `{ objects: next }`, which would wipe
`colors` on every object edit):

```ts
  // Replace the whole active screen's object list, preserving the screen's other
  // fields (colors) + other screens + shared config.
  const setObjects = (next: PrinterObject[]) => onChange(withScreenObjects(config, screen, next));
```

5c. Add to the `PrinterEditor` interface, after `setShared`:

```ts
  /** Set (or clear, with null) the active screen's palette override. */
  setScreenColors: (c: ScreenColors | null) => void;
```

5d. Implement next to `setShared` and add to the returned object:

```ts
  const setScreenColors = (c: ScreenColors | null) => {
    if (!disabled) onChange(withScreenColors(config, screen, c));
  };
```

```ts
    setShared,
    setScreenColors,
```

- [ ] **Step 6: Full gates and commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, tsc exit 0.

```bash
git add lib/printer-layout.ts lib/printer-layout.test.ts components/device-preview/printer-editor/use-printer-editor.ts
git commit -m "feat(branding): withScreenObjects/withScreenColors updaters; editor setScreenColors; object edits preserve screen colors

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Preview + stage render with the effective palette

**Files:**
- Modify: `components/device-preview/printer-preview.tsx`
- Modify: `components/device-preview/printer-editor/printer-stage.tsx`

**Interfaces:**
- Consumes: `screenColors(config, screen)` from Task 1.
- Produces: `export function effectiveBrand(brand: PrinterBrand, config: PrinterConfig, screen: PrinterScreen): PrinterBrand` in `printer-preview.tsx` (Task 4's studio chrome also uses `screenColors` directly).

- [ ] **Step 1: Add `effectiveBrand` to `printer-preview.tsx`**

Add `screenColors` to the existing `@/lib/printer-layout` import, then add above
`PrinterPreview`:

```ts
/** The brand with the screen's palette override applied (if any). */
export function effectiveBrand(
  brand: PrinterBrand,
  config: PrinterConfig,
  screen: PrinterScreen,
): PrinterBrand {
  const oc = screenColors(config, screen);
  if (!oc) return brand;
  return { ...brand, brandColor: oc.accent, brandBg: oc.bg, brandFg: oc.fg, brandMuted: oc.muted };
}
```

- [ ] **Step 2: Use it in `PrinterPreview`**

In `PrinterPreview`, resolve once and use for both the root style and the objects
(the `brand` prop stays the global brand; only rendering changes):

```ts
  const eb = effectiveBrand(brand, config, screen);
  const objects = [...config.screens[screen].objects]
    .filter((o) => o.visible)
    .sort((a, b) => a.z - b.z);
```

…and in the JSX replace `printerRootStyle(brand)` with `printerRootStyle(eb)` and
`<ObjectVisual object={o} brand={brand} config={config} />` with
`<ObjectVisual object={o} brand={eb} config={config} />`.

- [ ] **Step 3: Use it in `PrinterStage`**

In `printer-stage.tsx`, import `effectiveBrand` from `../printer-preview` and
resolve at the top of `PrinterStage` (the editor knows the active screen):

```ts
  const eb = effectiveBrand(brand, editor.config, editor.screen);
```

Replace `printerRootStyle(brand)` with `printerRootStyle(eb)` and
`<ObjectVisual object={o} brand={brand} config={config} />` with
`<ObjectVisual object={o} brand={eb} config={config} />`.

(`editor.screen` already exists on `PrinterEditor`; guides/selection/inline editor
read CSS vars and need no change.)

- [ ] **Step 4: Gates and commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: pass / exit 0. (The filmstrip in the studio renders `PrinterPreview`
per screen, so per-screen palettes now show automatically — visually verified in
Task 5.)

```bash
git add components/device-preview/printer-preview.tsx components/device-preview/printer-editor/printer-stage.tsx
git commit -m "feat(branding): preview + editor stage render each screen with its effective palette

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Theme tab UI — Global colors + per-screen override switch; studio chrome uses effective accent

**Files:**
- Modify: `components/branding-studio/branding-studio.tsx`

**Interfaces:**
- Consumes: `editor.setScreenColors(c | null)` (Task 2), `screenColors(config, screen)` (Task 1), existing locals `ColorField`, `PanelLabel`, `derivePalettes`, `SCREENS`, shadcn `Switch` (`@/components/ui/switch`).
- Produces: UI only — no new exports.

- [ ] **Step 1: Split the Theme tab**

In `ThemePanel` (`branding-studio.tsx`):

1a. Rename the first section's label from `Brand colors` to `Global colors` and
its description to:

```
Used by every screen that doesn't set its own colors below.
```

1b. Add imports: `Switch` from `@/components/ui/switch`, and extend the
`@/lib/printer-layout` import area — the file currently imports from
`@/lib/branding-presets`, `@/lib/branding-shell`, `@/lib/color`; add:

```ts
import { screenColors, type ScreenColors } from "@/lib/printer-layout";
```

1c. Append a new section at the end of `ThemePanel`'s fragment (after the preset
themes section):

```tsx
      {/* Per-screen override — scoped to the active screen (picked in the filmstrip) */}
      <ScreenColorsPanel draft={draft} />
```

1d. Add the component below `ThemePanel`:

```tsx
/** Per-screen palette override for the active screen. */
function ScreenColorsPanel({ draft }: { draft: BrandingDraft }) {
  const label = SCREENS.find((s) => s.value === draft.screen)?.label ?? draft.screen;
  const override = screenColors(draft.config, draft.screen);
  const globalPalette: ScreenColors = { accent: draft.color, bg: draft.bg, fg: draft.fg, muted: draft.muted };
  const set = (p: Partial<ScreenColors>) =>
    draft.editor.setScreenColors({ ...(override ?? globalPalette), ...p });
  const palettes = derivePalettes(override?.accent ?? draft.color);

  return (
    <section className="space-y-2.5 border-t pt-4">
      <div className="space-y-1">
        <PanelLabel>Screen colors — {label}</PanelLabel>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Give this screen its own palette. Pick the screen in the filmstrip below.
        </p>
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="screen-colors-switch" className="text-xs">
          Use custom colors for this screen
        </Label>
        <Switch
          id="screen-colors-switch"
          checked={override !== null}
          disabled={draft.disabled}
          onCheckedChange={(on) => draft.editor.setScreenColors(on ? globalPalette : null)}
        />
      </div>
      {override && (
        <>
          <div className="space-y-3 pt-1">
            <ColorField label="Accent" value={override.accent} onChange={(v) => set({ accent: v })} disabled={draft.disabled} />
            <ColorField label="Background" value={override.bg} onChange={(v) => set({ bg: v })} disabled={draft.disabled} />
            <ColorField label="Text" value={override.fg} onChange={(v) => set({ fg: v })} disabled={draft.disabled} />
            <ColorField label="Muted text" value={override.muted} onChange={(v) => set({ muted: v })} disabled={draft.disabled} />
          </div>
          <div className="flex gap-2 pt-1">
            {palettes.map((p) => {
              const active = eq(p.bg, override.bg) && eq(p.fg, override.fg) && eq(p.muted, override.muted);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={draft.disabled}
                  onClick={() => set({ bg: p.bg, fg: p.fg, muted: p.muted })}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-1.5 rounded-lg border py-2.5 ring-offset-2 ring-offset-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm disabled:pointer-events-none disabled:opacity-60",
                    active && "ring-2",
                  )}
                  style={active ? ({ "--tw-ring-color": override.accent } as React.CSSProperties) : undefined}
                >
                  <span className="flex -space-x-1">
                    {[p.bg, p.fg, p.muted].map((c, i) => (
                      <span key={i} className="size-4 rounded-full ring-1 ring-border" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="text-[10px] font-medium text-muted-foreground">{p.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
```

Notes for the implementer:
- `eq` and `cn` already exist in this file; `derivePalettes` is already imported.
- `ColorField` buffers hex text locally and calls `onChange` only with valid hex —
  reused as-is, so the config only ever receives valid values (normalize is the
  backstop for stored data).
- The switch seeds from the **current** global palette by design (spec: turning it
  on pins the screen; later global edits won't move it).

- [ ] **Step 2: Studio chrome uses the active screen's effective accent**

In `BrandingStudio` (same file), compute once after `activeScreen`:

```ts
  const stageAccent = screenColors(draft.config, draft.screen)?.accent ?? draft.color;
```

Then replace the two `draft.color` usages that style the stage:
- the accent glow: `background: \`radial-gradient(60% 55% at 50% 36%, ${withAlpha(stageAccent, 0.16)}, transparent 70%)\``
- the active filmstrip thumbnail ring: `({ "--tw-ring-color": stageAccent } as React.CSSProperties)`

(Leave every other `draft.color` usage — global color pickers, suggested-palette
ring in the global section — unchanged.)

- [ ] **Step 3: Gates**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: tests pass, tsc exit 0, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/branding-studio/branding-studio.tsx
git commit -m "feat(branding): Theme tab per-screen color override UI; stage chrome follows active screen accent

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Live QA (browser, temp tenant) — no code

**Files:** none (QA only; fixes discovered here become follow-up commits).

**Interfaces:** consumes the running app only.

- [ ] **Step 1: Start dev server**

Run: `npm run dev -- -p 3457` (background). Wait until `curl -s -o /dev/null -w "%{http_code}" http://localhost:3457/login` prints `200`.

⚠️ `.env.local` points at the PROD database. Do not modify existing tenants.

- [ ] **Step 2: Create a temp tenant (same recipe as 2026-07-13 QA)**

Write `tmp-qa-setup.ts` in the repo root (module resolution needs it there):
`auth.api.signUpEmail({ body: { email: "qa-theming-tmp@maratus.test", password: "qa-tmp-123456", name: "QA Theming Tmp" } })`, then insert
`organization { id: "qa-theming-tmp-org", name: "QA Theming Tmp", slug: "qa-theming-tmp", createdAt: new Date() }` and
`member { id: "qa-theming-tmp-member", organizationId, userId, role: "owner", createdAt: new Date() }` (both `.onConflictDoNothing()`), and set the user's `emailVerified = true`. Run with `npx tsx tmp-qa-setup.ts`.

- [ ] **Step 3: Browser QA checklist (Playwright MCP)**

Sign in via `POST /api/auth/sign-in/email` fetch from the page, open
`http://localhost:3457/tenant/branding`. React handlers need native event
sequences (`pointerdown → mousedown → pointerup → mouseup → click` via
`browser_evaluate`) — plain `browser_click` does not fire them on this app.

Verify each item:
1. Theme tab shows **Global colors** section and **Screen colors — Idle / ready** section with the switch OFF.
2. Turn the switch ON → 4 color fields appear pre-filled with the global palette; dirty indicator flips to "Unsaved changes".
3. Change the screen Background to `#111827` → stage background changes, **idle filmstrip thumbnail** changes, other 6 thumbnails do not.
4. Switch screens via filmstrip (e.g. Error) → Screen colors section shows "— Error / offline" with switch OFF (that screen inherits).
5. On Idle: move/resize an object, add a Text object, then click **Reset layout to default** (Screen tab) → objects reseed but the screen's custom colors stay applied throughout (setObjects/resetLayout preserve colors).
6. Change a **global** color → non-overridden screens change; the overridden idle screen does not.
7. Turn the idle switch OFF → idle reverts to global palette instantly.
8. Turn it ON again, set a palette, click **Save** → "Branding saved" toast; hard-reload `/tenant/branding` → override persists (fields + thumbnail).
9. `GET /api/device/config` contract: not directly testable without a device key — instead confirm persistence via reload (same stored `printerScreens` the payload ships) and that `screens.idle.colors` appears in the saved config: run a read-only `tmp-qa-check.ts` that selects `printerScreens` from `tenant_settings` for `qa-theming-tmp-org` and prints `screens.idle.colors`.

- [ ] **Step 4: Clean up the temp tenant**

`tmp-qa-cleanup.ts` (repo root, then delete all tmp-*.ts files): delete rows in order
`audit_log (organization_id)`, `tenant_settings`, `member`, `session (user)`,
`account (user)`, `verification (identifier like %email%)`, `organization`, `user`
for `qa-theming-tmp-org` / `qa-theming-tmp@maratus.test`; print remaining counts
(must be 0). Kill the dev server.

- [ ] **Step 5: Report**

Report QA results (pass/fail per checklist item). Deployment happens only on the
owner's explicit request (established workflow: push + `vercel deploy --prod` +
smoke `/login` 200 — the GitHub webhook has been unreliable).

"use client";

// Layout variant A — "Canvas Studio": one immersive dark stage that dominates
// the page (Figma-style), with a floating control rail on the left, a live
// filmstrip of all screens along the bottom, and save chrome in the stage
// header. Pure layout over useBrandingDraft — no state of its own beyond
// zoom and the active tab.

import * as React from "react";
import {
  LayoutGrid,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Minus,
  Palette,
  Plus,
  RotateCcw,
  Save,
} from "lucide-react";
import { PrinterPreview } from "@/components/device-preview/printer-preview";
import { PrinterStage } from "@/components/device-preview/printer-editor/printer-stage";
import { PrinterControls } from "@/components/device-preview/printer-editor/printer-controls";
import {
  useBrandingDraft,
  SCREENS,
  type BrandingVariantProps,
  type BrandingDraft,
} from "@/components/branding-studio/use-branding-draft";
import { BRAND_THEMES, themeMatches, derivePalettes } from "@/lib/branding-presets";
import {
  clampZoom,
  zoomToPx,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  ZOOM_DEFAULT,
} from "@/lib/branding-shell";
import { isValidHex, withAlpha } from "@/lib/color";
import { screenColors, type ScreenColors } from "@/lib/printer-layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function BrandingStudio(props: BrandingVariantProps) {
  const draft = useBrandingDraft(props);
  const [zoom, setZoom] = React.useState(ZOOM_DEFAULT);
  const [fullscreen, setFullscreen] = React.useState(false);
  const previewPx = zoomToPx(zoom);
  const activeScreen = SCREENS.find((s) => s.value === draft.screen);
  const stageAccent = screenColors(draft.config, draft.screen)?.accent ?? draft.color;

  // Full-screen mode: lock page scroll behind the overlay, exit on Escape.
  React.useEffect(() => {
    if (!fullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreen]);

  return (
    <div className="relative space-y-6">
      {!draft.canEdit && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" />
          You have view-only access. Only owners and admins can edit branding.
        </div>
      )}

      <div
        className={cn(
          "relative",
          fullscreen &&
            "fixed inset-0 z-50 overflow-y-auto bg-zinc-950 lg:overflow-hidden",
        )}
      >
        {/* FLOATING CONTROL RAIL — in-flow above the stage on mobile; a
            full-height panel floating over the stage's left edge on lg+. */}
        <div
          className={cn(
            "relative z-30 mb-4 lg:absolute lg:inset-auto lg:bottom-4 lg:left-4 lg:top-[4.25rem] lg:mb-0 lg:w-[19.5rem]",
            fullscreen && "p-3 pb-0 lg:p-0",
          )}
        >
          <ControlPanel draft={draft} />
        </div>

        {/* THE STAGE */}
        <div
          className={cn(
            "relative flex flex-col overflow-hidden bg-zinc-950",
            fullscreen
              ? "min-h-dvh lg:h-full lg:min-h-0"
              : "min-h-[calc(100vh-14rem)] rounded-2xl shadow-xl ring-1 ring-zinc-800/80",
          )}
        >
          {/* Dot-grid texture + accent-tinted glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.09) 1px, transparent 0)",
              backgroundSize: "22px 22px",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(60% 55% at 50% 36%, ${withAlpha(stageAccent, 0.16)}, transparent 70%)`,
            }}
          />

          <StageHeader
            draft={draft}
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen((f) => !f)}
          />

          {/* CANVAS — the active screen, editable, centered on the surface */}
          <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 sm:p-10 lg:pl-[21.5rem]">
            <div
              className="max-w-full transition-[width] duration-200 ease-out"
              style={{ width: previewPx }}
            >
              <PrinterStage editor={draft.editor} brand={draft.printerBrand} />
            </div>
            <p className="text-center text-xs text-zinc-500">
              {draft.screen === "idle"
                ? "Drag to arrange — double-click any text to edit it."
                : `Editing the ${activeScreen?.label.toLowerCase() ?? "selected"} screen. The QR shown is illustrative.`}
            </p>

            {/* Zoom pill */}
            <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/80 py-1.5 pl-3 pr-4 shadow-lg backdrop-blur">
              <button
                type="button"
                onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
                aria-label="Zoom out"
                className="flex size-6 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
              >
                <Minus className="size-3.5" />
              </button>
              <Slider
                value={[zoom]}
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={ZOOM_STEP}
                onValueChange={(v) => setZoom(clampZoom(v[0]))}
                aria-label="Preview zoom"
                className="hidden w-24 sm:flex"
              />
              <button
                type="button"
                onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
                aria-label="Zoom in"
                className="flex size-6 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
              >
                <Plus className="size-3.5" />
              </button>
              <span className="w-9 text-right font-mono text-[11px] tabular-nums text-zinc-400">
                {zoom}%
              </span>
            </div>
          </div>

          {/* FILMSTRIP — all 7 screens as live thumbnails */}
          <div className="relative z-10 border-t border-white/10 bg-zinc-950/60 px-4 py-3 backdrop-blur lg:pl-[21.5rem]">
            <div className="flex gap-3 overflow-x-auto pb-1">
              {SCREENS.map((s) => {
                const active = s.value === draft.screen;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => draft.setScreen(s.value)}
                    className="group shrink-0 focus-visible:outline-none"
                    aria-label={`Edit ${s.label} screen`}
                    aria-current={active ? "true" : undefined}
                  >
                    <span
                      className={cn(
                        "block w-[104px] overflow-hidden rounded-lg transition-all duration-200 group-hover:scale-[1.04] group-focus-visible:scale-[1.04]",
                        active
                          ? "ring-2 shadow-lg"
                          : "opacity-80 ring-1 ring-white/10 group-hover:opacity-100 group-hover:ring-white/30",
                      )}
                      style={
                        active
                          ? ({ "--tw-ring-color": stageAccent } as React.CSSProperties)
                          : undefined
                      }
                    >
                      {/* pointer-events-none so clicks select the screen, never drag objects */}
                      <span className="pointer-events-none block select-none">
                        <PrinterPreview
                          brand={draft.printerBrand}
                          config={draft.config}
                          screen={s.value}
                        />
                      </span>
                    </span>
                    <span
                      className={cn(
                        "mt-1.5 block max-w-[104px] truncate text-center text-[10px] font-medium transition-colors",
                        active ? "text-zinc-100" : "text-zinc-500 group-hover:text-zinc-300",
                      )}
                    >
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Stage header — title, store name, dirty indicator, Reset + Save           */
/* ------------------------------------------------------------------------ */

function StageHeader({
  draft,
  fullscreen,
  onToggleFullscreen,
}: {
  draft: BrandingDraft;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  return (
    <div className="relative z-20 flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="shrink-0 text-sm font-semibold text-zinc-100">Branding studio</h2>
        <span className="truncate text-xs text-zinc-500">{draft.storeName}</span>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <span className="hidden items-center gap-2 text-xs text-zinc-400 sm:flex">
          <span
            className={cn(
              "size-2 rounded-full transition-colors",
              draft.dirty ? "bg-amber-400" : "bg-emerald-400",
            )}
          />
          {draft.dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? "Exit full screen" : "Enter full screen"}
          title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
          className="inline-flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-200 transition-colors hover:bg-white/10"
        >
          {fullscreen ? (
            <Minimize2 className="size-3.5" />
          ) : (
            <Maximize2 className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={draft.reset}
          disabled={draft.disabled || !draft.dirty}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40"
        >
          <RotateCcw className="size-3.5" /> Reset
        </button>
        <button
          type="button"
          onClick={draft.save}
          disabled={draft.disabled || !draft.dirty}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3.5 text-xs font-semibold text-zinc-900 shadow-sm transition-colors hover:bg-zinc-200 disabled:pointer-events-none disabled:opacity-40"
        >
          {draft.saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          {draft.saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Floating control panel — Theme / Screen / Security                        */
/* ------------------------------------------------------------------------ */

function ControlPanel({ draft }: { draft: BrandingDraft }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-2xl lg:h-full dark:border-white/10">
      <Tabs defaultValue="theme" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="shrink-0 border-b p-2.5">
          <TabsList className="w-full">
            <TabsTrigger value="theme">
              <Palette className="size-3.5" /> Theme
            </TabsTrigger>
            <TabsTrigger value="screen">
              <LayoutGrid className="size-3.5" /> Screen
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="max-h-[24rem] min-h-0 flex-1 overflow-y-auto p-4 lg:max-h-none">
          <TabsContent value="theme" className="mt-0 space-y-5">
            <ThemePanel draft={draft} />
          </TabsContent>

          <TabsContent value="screen" className="mt-0 space-y-4">
            <div className="flex items-baseline justify-between gap-2">
              <PanelLabel>
                {SCREENS.find((s) => s.value === draft.screen)?.label ?? "Screen"}
              </PanelLabel>
              <span className="text-[10px] text-muted-foreground">
                switch in the filmstrip
              </span>
            </div>
            <PrinterControls
              editor={draft.editor}
              onImageUpload={draft.onImageUpload}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

/* ---- Theme tab ---------------------------------------------------------- */

function ThemePanel({ draft }: { draft: BrandingDraft }) {
  const current = { accent: draft.color, bg: draft.bg, fg: draft.fg, muted: draft.muted };
  const palettes = derivePalettes(draft.color);

  return (
    <>
      {/* Custom brand colors — first-class, nothing hidden */}
      <section className="space-y-2.5">
        <div className="space-y-1">
          <PanelLabel>Global colors</PanelLabel>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Used by every screen that doesn&apos;t set its own colors below.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label
            className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-border transition-transform hover:scale-105"
            style={{ background: draft.color }}
          >
            <input
              type="color"
              value={draft.color}
              onChange={(e) => draft.setAccent(e.target.value)}
              disabled={draft.disabled}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Pick accent color"
            />
          </label>
          <div className="flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">Accent</Label>
            <Input
              value={draft.hexInput}
              onChange={(e) => draft.commitHex(e.target.value)}
              disabled={draft.disabled}
              className="h-8 font-mono text-xs"
              aria-invalid={!isValidHex(draft.hexInput)}
              aria-label="Accent color hex"
            />
          </div>
        </div>
        <div className="space-y-3 pt-1">
          <ColorField label="Background" value={draft.bg} onChange={draft.setBg} disabled={draft.disabled} />
          <ColorField label="Text" value={draft.fg} onChange={draft.setFg} disabled={draft.disabled} />
          <ColorField label="Muted text" value={draft.muted} onChange={draft.setMuted} disabled={draft.disabled} />
        </div>
      </section>

      {/* Auto palettes derived from the accent */}
      <section className="space-y-2">
        <div className="space-y-1">
          <PanelLabel>Suggested palettes</PanelLabel>
          <p className="text-[11px] text-muted-foreground">
            Background &amp; text combos derived from your accent.
          </p>
        </div>
        <div className="flex gap-2">
          {palettes.map((p) => {
            const active = eq(p.bg, draft.bg) && eq(p.fg, draft.fg) && eq(p.muted, draft.muted);
            return (
              <button
                key={p.id}
                type="button"
                disabled={draft.disabled}
                onClick={() => draft.applyTheme({ bg: p.bg, fg: p.fg, muted: p.muted })}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1.5 rounded-lg border py-2.5 ring-offset-2 ring-offset-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm disabled:pointer-events-none disabled:opacity-60",
                  active && "ring-2",
                )}
                style={
                  active
                    ? ({ "--tw-ring-color": draft.color } as React.CSSProperties)
                    : undefined
                }
              >
                <span className="flex -space-x-1">
                  {[p.bg, p.fg, p.muted].map((c, i) => (
                    <span
                      key={i}
                      className="size-4 rounded-full ring-1 ring-border"
                      style={{ background: c }}
                    />
                  ))}
                </span>
                <span className="text-[10px] font-medium text-muted-foreground">{p.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Curated preset themes — optional shortcuts */}
      <section className="space-y-2">
        <div className="space-y-1">
          <PanelLabel>Preset themes</PanelLabel>
          <p className="text-[11px] text-muted-foreground">
            Optional shortcuts — applying one just fills in the colors above.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {BRAND_THEMES.map((t) => {
            const active = themeMatches(t, current);
            return (
              <button
                key={t.id}
                type="button"
                disabled={draft.disabled}
                onClick={() => draft.applyTheme(t)}
                title={t.description}
                className={cn(
                  "rounded-lg border p-2 text-left ring-offset-2 ring-offset-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-60",
                  active && "ring-2",
                )}
                style={{
                  background: t.bg,
                  ...(active
                    ? ({ "--tw-ring-color": t.accent } as React.CSSProperties)
                    : null),
                }}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-3 shrink-0 rounded-full ring-1 ring-black/10"
                    style={{ background: t.accent }}
                  />
                  <span
                    className="truncate text-[11px] font-semibold"
                    style={{ color: t.fg }}
                  >
                    {t.name}
                  </span>
                </span>
                <span
                  className="mt-1.5 block h-1 w-8 rounded-full"
                  style={{ background: t.muted }}
                />
              </button>
            );
          })}
        </div>
      </section>

      {/* Per-screen override — scoped to the active screen (picked in the filmstrip) */}
      <ScreenColorsPanel draft={draft} />
    </>
  );
}

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

/* ---- Shared -------------------------------------------------------------- */

/** Swatch + hex input for a single theme token. */
function ColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [hex, setHex] = React.useState(value);
  React.useEffect(() => setHex(value), [value]);
  return (
    <div className="flex items-center gap-3">
      <label
        className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-lg ring-1 ring-border"
        style={{ background: value }}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={`Pick ${label}`}
        />
      </label>
      <div className="flex-1 space-y-1">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Input
          value={hex}
          onChange={(e) => {
            setHex(e.target.value);
            if (isValidHex(e.target.value)) {
              onChange(e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`);
            }
          }}
          disabled={disabled}
          className="h-8 font-mono text-xs"
          aria-invalid={!isValidHex(hex)}
        />
      </div>
    </div>
  );
}

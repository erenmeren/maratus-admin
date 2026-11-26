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
  QrCode,
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
import {
  screenColors,
  QR_SHAPES,
  QR_SHADOW_MODES,
  type QrShadowMode,
  type QrShape,
  type ScreenColors,
} from "@/lib/printer-layout";
import { QrSvg } from "@/components/qr-svg";
import { qrCornerRadiusPx, qrShadowBoxShadow } from "@/lib/qr-svg";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { SectionHistory } from "@/components/section-history";

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
      // Radix dialogs/popovers preventDefault the Escape they close; leave fullscreen on.
      if (e.key === "Escape" && !e.defaultPrevented) setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreen]);

  return (
    <div className="relative space-y-4">
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
            "fixed inset-0 z-50 overflow-y-auto bg-background lg:overflow-hidden",
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
            // Always dark, whatever the app theme: `dark` re-scopes the tokens for the stage.
            "dark relative flex flex-col overflow-hidden bg-background text-foreground",
            fullscreen
              ? "min-h-dvh lg:h-full lg:min-h-0"
              : "min-h-[calc(100dvh-14rem)] rounded-xl ring-1 ring-border",
          )}
        >
          {/* Dot-grid texture + accent-tinted glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, var(--edge) 1px, transparent 0)",
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
            <p className="text-center text-xs text-muted-foreground">
              {draft.screen === "idle"
                ? "Drag to arrange — double-click any text to edit it."
                : `Editing the ${activeScreen?.label.toLowerCase() ?? "selected"} screen. The QR shown is illustrative.`}
            </p>

            {/* Zoom pill */}
            <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full border border-border bg-popover/80 py-1.5 pl-3 pr-4 backdrop-blur">
              <button
                type="button"
                onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
                aria-label="Zoom out"
                className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="size-3.5" />
              </button>
              <span className="w-9 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {zoom}%
              </span>
            </div>
          </div>

          {/* FILMSTRIP — all screens as live thumbnails */}
          <div className="relative z-10 border-t border-border bg-background/60 px-4 py-3 backdrop-blur lg:pl-[21.5rem]">
            {/* p-1.5 gives the active thumbnail's ring-2 + shadow room inside the
                scroll box — overflow-x-auto forces overflow-y to auto, which would
                otherwise clip the top ring and the leftmost item's left ring. */}
            <div className="flex gap-3 overflow-x-auto p-1.5">
              {SCREENS.map((s) => {
                const active = s.value === draft.screen;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => draft.setScreen(s.value)}
                    className="group shrink-0 rounded-lg focus-visible:outline-none"
                    aria-label={`Edit ${s.label} screen`}
                    aria-current={active ? "true" : undefined}
                  >
                    <span
                      className={cn(
                        "block w-[104px] overflow-hidden rounded-lg outline-offset-2 outline-ring transition-[opacity,box-shadow] duration-150 group-focus-visible:outline-2",
                        active
                          ? "ring-2"
                          : "opacity-80 ring-1 ring-border group-hover:opacity-100 group-hover:ring-line-strong",
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
                        "mt-1.5 block max-w-[104px] truncate text-center text-xs font-medium transition-colors",
                        active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
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
    <div className="relative z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="shrink-0 text-sm font-semibold text-foreground">Branding studio</h2>
        <span className="truncate text-xs text-muted-foreground">{draft.storeName}</span>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
          <span
            className={cn(
              "size-2 rounded-full transition-colors",
              draft.dirty ? "bg-status-paused" : "bg-status-online",
            )}
          />
          {draft.dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? "Exit full screen" : "Enter full screen"}
          title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
          className="inline-flex size-8 items-center justify-center rounded-md border border-line-strong text-foreground transition-colors hover:bg-hover"
        >
          {fullscreen ? (
            <Minimize2 className="size-3.5" />
          ) : (
            <Maximize2 className="size-3.5" />
          )}
        </button>
        <SectionHistory
          section="branding"
          className="h-8 gap-1.5 rounded-md border border-line-strong bg-transparent px-3 text-xs font-medium text-foreground hover:bg-hover hover:text-foreground"
        />
        <button
          type="button"
          onClick={draft.reset}
          disabled={draft.disabled || !draft.dirty}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 text-xs font-medium text-foreground transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-40"
        >
          <RotateCcw className="size-3.5" /> Reset
        </button>
        <button
          type="button"
          onClick={draft.save}
          disabled={draft.disabled || !draft.dirty}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-40"
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
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-[var(--lift)] lg:h-full">
      <Tabs defaultValue="theme" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="shrink-0 border-b p-2.5">
          <TabsList className="w-full">
            <TabsTrigger value="theme">
              <Palette className="size-3.5" /> Theme
            </TabsTrigger>
            <TabsTrigger value="qr">
              <QrCode className="size-3.5" /> QR
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

          <TabsContent value="qr" className="mt-0 space-y-4">
            <QrStylePanel draft={draft} />
          </TabsContent>

          <TabsContent value="screen" className="mt-0 space-y-4">
            <div className="flex items-baseline justify-between gap-2">
              <PanelLabel>
                {SCREENS.find((s) => s.value === draft.screen)?.label ?? "Screen"}
              </PanelLabel>
              <span className="text-xs text-muted-foreground">
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
    <p className="text-xs font-medium text-foreground">
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
          <p className="text-xs leading-relaxed text-muted-foreground">
            Used by every screen that doesn&apos;t set its own colors below.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label
            className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-border transition-shadow duration-150 hover:ring-line-strong"
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
          <p className="text-xs text-muted-foreground">
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
                  "flex flex-1 flex-col items-center gap-1.5 rounded-lg border py-2.5 ring-offset-2 ring-offset-card transition-colors duration-[120ms] hover:border-line-strong disabled:pointer-events-none disabled:opacity-60",
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
                <span className="text-xs font-medium text-muted-foreground">{p.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Curated preset themes — optional shortcuts */}
      <section className="space-y-2">
        <div className="space-y-1">
          <PanelLabel>Preset themes</PanelLabel>
          <p className="text-xs text-muted-foreground">
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
                  "rounded-lg border p-2 text-left ring-offset-2 ring-offset-card transition-colors duration-[120ms] hover:border-line-strong disabled:pointer-events-none disabled:opacity-60",
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
                    className="truncate text-xs font-semibold"
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

const QR_SHAPE_LABEL: Record<QrShape, string> = {
  classic: "Classic",
  soft: "Soft",
  rounded: "Rounded",
  dots: "Dots",
};

const QR_SHADOW_MODE_LABEL: Record<QrShadowMode, string> = {
  none: "None",
  drop: "Drop",
  neon: "Neon",
};

// Illustrative-only value — same one QrObject (printer-preview) uses for mockups.
const QR_STYLE_PREVIEW_VALUE = "https://maratus.co";

/** Org-wide QR shape, colors, background corner + shadow — its own studio tab
 *  (moved out of Theme 2026-07-23 so the theme panel isn't as crowded). Saved
 *  through the same config JSON as everything else (draft.config.qrShape/
 *  qrFg/qrBg/qrCornerRadius/qrShadow, set via editor.setShared). */
function QrStylePanel({ draft }: { draft: BrandingDraft }) {
  const { qrShape, qrFg, qrBg, qrCornerRadius, qrShadowMode, qrShadowStrength, qrShadowColor } = draft.config;
  const set = (
    p: Partial<{
      qrShape: QrShape;
      qrFg: string;
      qrBg: string;
      qrCornerRadius: number;
      qrShadowMode: QrShadowMode;
      qrShadowStrength: number;
      qrShadowColor: string;
    }>,
  ) => draft.editor.setShared(p);

  return (
    <>
      <section className="space-y-2.5">
        <div className="space-y-1">
          <PanelLabel>Shape</PanelLabel>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Applies to every QR on every screen — device, pinned, and setup.
          </p>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {QR_SHAPES.map((s) => {
            const active = s === qrShape;
            return (
              <button
                key={s}
                type="button"
                disabled={draft.disabled}
                onClick={() => set({ qrShape: s })}
                aria-pressed={active}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-2 ring-offset-2 ring-offset-card transition-colors duration-[120ms] hover:border-line-strong disabled:pointer-events-none disabled:opacity-60",
                  active && "ring-2",
                )}
                style={active ? ({ "--tw-ring-color": draft.color } as React.CSSProperties) : undefined}
              >
                <span className="flex size-10 items-center justify-center rounded-md p-1" style={{ background: qrBg }}>
                  <QrSvg
                    value={QR_STYLE_PREVIEW_VALUE}
                    shape={s}
                    fg={qrFg}
                    bg={qrBg}
                    style={{ width: "100%", height: "100%", display: "block" }}
                    ariaLabel={`${QR_SHAPE_LABEL[s]} QR style preview`}
                  />
                </span>
                <span className="text-xs font-medium text-muted-foreground">{QR_SHAPE_LABEL[s]}</span>
              </button>
            );
          })}
        </div>

        <div className="space-y-3 pt-1">
          <ColorField label="QR color" value={qrFg} onChange={(v) => set({ qrFg: v })} disabled={draft.disabled} />
          <ColorField label="QR background" value={qrBg} onChange={(v) => set({ qrBg: v })} disabled={draft.disabled} />
        </div>
      </section>

      {/* Background plate — corner + shadow. Used to be hard-coded (always
       *  rounded, always shadowed) in the preview while the device rendered
       *  square + shadowless; both are now an org-wide choice (2026-07-23). */}
      <section className="space-y-2.5 border-t pt-4">
        <div className="space-y-1">
          <PanelLabel>Background plate</PanelLabel>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The surface behind the code — corner rounding and drop shadow.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className="flex size-10 shrink-0 items-center justify-center"
            style={{ background: qrBg }}
          >
            <span
              className="size-5"
              style={{ background: qrFg, borderRadius: qrCornerRadiusPx(20, qrCornerRadius) }}
            />
          </span>
          <div className="flex-1 space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label className="text-xs">Corner radius</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{qrCornerRadius}</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[qrCornerRadius]}
              onValueChange={([v]) => set({ qrCornerRadius: v })}
              disabled={draft.disabled}
              aria-label="QR corner radius"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1">
          {QR_SHADOW_MODES.map((m) => {
            const active = m === qrShadowMode;
            return (
              <button
                key={m}
                type="button"
                disabled={draft.disabled}
                onClick={() => set({ qrShadowMode: m })}
                aria-pressed={active}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-2 ring-offset-2 ring-offset-card transition-colors duration-[120ms] hover:border-line-strong disabled:pointer-events-none disabled:opacity-60",
                  active && "ring-2",
                )}
                style={active ? ({ "--tw-ring-color": draft.color } as React.CSSProperties) : undefined}
              >
                <span className="flex size-10 items-center justify-center overflow-visible p-1.5">
                  <span
                    className="size-5 rounded-sm"
                    style={{
                      background: qrBg,
                      // 20 = the `size-5` swatch below, in px.
                      boxShadow: qrShadowBoxShadow(m, qrShadowStrength, qrShadowColor, 20),
                    }}
                  />
                </span>
                <span className="text-xs font-medium text-muted-foreground">{QR_SHADOW_MODE_LABEL[m]}</span>
              </button>
            );
          })}
        </div>

        {qrShadowMode !== "none" && (
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label className="text-xs">Intensity</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{qrShadowStrength}</span>
              </div>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[qrShadowStrength]}
                onValueChange={([v]) => set({ qrShadowStrength: v })}
                disabled={draft.disabled}
                aria-label="Shadow intensity"
              />
            </div>
            <ColorField
              label="Shadow color"
              value={qrShadowColor}
              onChange={(v) => set({ qrShadowColor: v })}
              disabled={draft.disabled}
            />
          </div>
        )}
      </section>
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
        <p className="text-xs leading-relaxed text-muted-foreground">
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
                    "flex flex-1 flex-col items-center gap-1.5 rounded-lg border py-2.5 ring-offset-2 ring-offset-card transition-colors duration-[120ms] hover:border-line-strong disabled:pointer-events-none disabled:opacity-60",
                    active && "ring-2",
                  )}
                  style={active ? ({ "--tw-ring-color": override.accent } as React.CSSProperties) : undefined}
                >
                  <span className="flex -space-x-1">
                    {[p.bg, p.fg, p.muted].map((c, i) => (
                      <span key={i} className="size-4 rounded-full ring-1 ring-border" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">{p.name}</span>
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

"use client";

// Layout variant A — "Canvas Studio": one immersive dark stage that dominates
// the page (Figma-style), with a floating control rail on the left, a live
// filmstrip of all screens along the bottom, and save chrome in the stage
// header. Pure layout over useBrandingDraft — no state of its own beyond
// zoom / tab / PIN visibility.

import * as React from "react";
import {
  Eye,
  EyeOff,
  LayoutGrid,
  Loader2,
  Lock,
  Minus,
  Palette,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

const PRESETS = ["#B4541F", "#3F9D4E", "#1F5C8B", "#E5484D", "#7C5CFC", "#0F766E", "#111827"];

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function BrandingStudio(props: BrandingVariantProps) {
  const draft = useBrandingDraft(props);
  const [zoom, setZoom] = React.useState(ZOOM_DEFAULT);
  const previewPx = zoomToPx(zoom);
  const activeScreen = SCREENS.find((s) => s.value === draft.screen);

  return (
    <div className="relative space-y-6">
      {!draft.canEdit && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" />
          You have view-only access. Only owners and admins can edit branding.
        </div>
      )}

      <div className="relative">
        {/* FLOATING CONTROL RAIL — in-flow above the stage on mobile; a
            full-height panel floating over the stage's left edge on lg+. */}
        <div className="relative z-30 mb-4 lg:absolute lg:inset-auto lg:bottom-4 lg:left-4 lg:top-[4.25rem] lg:mb-0 lg:w-[19.5rem]">
          <ControlPanel draft={draft} />
        </div>

        {/* THE STAGE */}
        <div className="relative flex min-h-[calc(100vh-14rem)] flex-col overflow-hidden rounded-2xl bg-zinc-950 shadow-xl ring-1 ring-zinc-800/80">
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
              background: `radial-gradient(60% 55% at 50% 36%, ${withAlpha(draft.color, 0.16)}, transparent 70%)`,
            }}
          />

          <StageHeader draft={draft} />

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
                          ? ({ "--tw-ring-color": draft.color } as React.CSSProperties)
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

function StageHeader({ draft }: { draft: BrandingDraft }) {
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
            <TabsTrigger value="security">
              <ShieldCheck className="size-3.5" /> Security
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="max-h-[24rem] min-h-0 flex-1 overflow-y-auto p-4 lg:max-h-none">
          <TabsContent value="theme" className="mt-0 space-y-5">
            <ThemePanel draft={draft} />
          </TabsContent>

          <TabsContent value="screen" className="mt-0 space-y-4">
            <div>
              <PanelLabel>
                {SCREENS.find((s) => s.value === draft.screen)?.label ?? "Screen"}
              </PanelLabel>
              <p className="mt-1 text-xs text-muted-foreground">
                Layout for the selected screen — pick another in the filmstrip below the canvas.
              </p>
            </div>
            <PrinterControls
              editor={draft.editor}
              onIconUpload={draft.onIconUpload}
              onImageUpload={draft.onImageUpload}
            />
          </TabsContent>

          <TabsContent value="security" className="mt-0 space-y-4">
            <SecurityPanel draft={draft} />
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
      {/* Curated themes */}
      <section className="space-y-2">
        <PanelLabel>Themes</PanelLabel>
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

      {/* Accent color */}
      <section className="space-y-2.5">
        <PanelLabel>Accent color</PanelLabel>
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
          <Input
            value={draft.hexInput}
            onChange={(e) => draft.commitHex(e.target.value)}
            disabled={draft.disabled}
            className="h-9 font-mono text-sm"
            aria-invalid={!isValidHex(draft.hexInput)}
            aria-label="Accent color hex"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              disabled={draft.disabled}
              onClick={() => draft.setAccent(c)}
              className={cn(
                "size-7 rounded-md ring-1 ring-border transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-60",
                eq(draft.color, c) &&
                  "ring-2 ring-foreground ring-offset-2 ring-offset-card",
              )}
              style={{ background: c }}
              aria-label={`Use ${c}`}
            />
          ))}
        </div>
      </section>

      {/* Auto palettes derived from the accent */}
      <section className="space-y-2">
        <PanelLabel>Auto palettes</PanelLabel>
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

      {/* Advanced — individual theme tokens */}
      <Accordion type="single" collapsible>
        <AccordionItem value="advanced" className="border-none">
          <AccordionTrigger className="py-2 text-xs font-medium text-muted-foreground hover:no-underline">
            Advanced — individual colors
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pt-1">
            <ColorField label="Background" value={draft.bg} onChange={draft.setBg} disabled={draft.disabled} />
            <ColorField label="Text" value={draft.fg} onChange={draft.setFg} disabled={draft.disabled} />
            <ColorField label="Muted text" value={draft.muted} onChange={draft.setMuted} disabled={draft.disabled} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Logo text */}
      <section className="space-y-2">
        <Label htmlFor="studio-logoText" className="text-xs">
          Logo text (preview fallback)
        </Label>
        <Input
          id="studio-logoText"
          value={draft.logoText}
          onChange={(e) => draft.setLogoText(e.target.value)}
          placeholder="Your brand"
          disabled={draft.disabled}
          className="h-9"
        />
      </section>
    </>
  );
}

/* ---- Security tab -------------------------------------------------------- */

function SecurityPanel({ draft }: { draft: BrandingDraft }) {
  const [showPin, setShowPin] = React.useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor="studio-staffPin">Staff PIN</Label>
      <div className="relative">
        <Input
          id="studio-staffPin"
          value={draft.pin}
          onChange={(e) => draft.setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          type={showPin ? "text" : "password"}
          inputMode="numeric"
          disabled={draft.disabled}
          className="pr-10 font-mono tracking-[0.3em]"
          placeholder="••••"
        />
        <button
          type="button"
          onClick={() => setShowPin((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={showPin ? "Hide PIN" : "Show PIN"}
        >
          {showPin ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Staff enter this PIN on the device to open its settings.
      </p>
    </div>
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

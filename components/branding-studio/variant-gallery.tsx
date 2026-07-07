"use client";

// Layout prototype B — "Gallery first, editor second".
// The whole brand story at a glance: a curated theme shelf up top, a compact
// brand-basics card, then a large live grid of every printer screen. Clicking
// a screen opens a near-full-screen focused editor dialog with the drag-and-
// drop stage on the left and the object controls on the right.
//
// Pure layout over useBrandingDraft — no state of its own beyond UI chrome.

import * as React from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Pencil,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import {
  PrinterPreview,
  type PrinterScreen,
} from "@/components/device-preview/printer-preview";
import { PrinterStage } from "@/components/device-preview/printer-editor/printer-stage";
import { PrinterControls } from "@/components/device-preview/printer-editor/printer-controls";
import {
  useBrandingDraft,
  SCREENS,
  type BrandingVariantProps,
  type BrandingDraft,
} from "@/components/branding-studio/use-branding-draft";
import {
  BRAND_THEMES,
  themeMatches,
  derivePalettes,
  type BrandTheme,
  type DerivedPalette,
} from "@/lib/branding-presets";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { isValidHex } from "@/lib/color";
import { cn } from "@/lib/utils";

const PRESETS = ["#B4541F", "#3F9D4E", "#1F5C8B", "#E5484D", "#7C5CFC", "#0F766E", "#111827"];

const eqHex = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function BrandingGalleryVariant(props: BrandingVariantProps) {
  const draft = useBrandingDraft(props);
  const {
    color, hexInput, setAccent, commitHex,
    bg, setBg, fg, setFg, muted, setMuted, applyTheme,
    logoText, setLogoText, pin, setPin,
    screen, setScreen, editor, onIconUpload, onImageUpload,
    printerBrand, dirty, saving, disabled, canEdit, save, reset,
  } = draft;

  const [editOpen, setEditOpen] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [showPin, setShowPin] = React.useState(false);

  const palettes = React.useMemo(() => derivePalettes(color), [color]);
  const paletteActive = (p: DerivedPalette) =>
    eqHex(p.bg, bg) && eqHex(p.fg, fg) && eqHex(p.muted, muted);

  const screenIndex = Math.max(0, SCREENS.findIndex((s) => s.value === screen));
  const screenLabel = SCREENS[screenIndex]?.label ?? "Screen";
  const stepScreen = (delta: number) =>
    setScreen(SCREENS[(screenIndex + delta + SCREENS.length) % SCREENS.length].value);

  const openScreen = (s: PrinterScreen) => {
    setScreen(s);
    setEditOpen(true);
  };

  return (
    <div className="relative space-y-6">
      {!canEdit && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" />
          You have view-only access. Only owners and admins can edit branding.
        </div>
      )}

      {/* 1 — THEME SHELF */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <Sparkles className="size-4 text-muted-foreground" /> Theme presets
          </h2>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Start from a curated look — every screen updates instantly.
          </p>
        </div>
        <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pt-1 pb-3 [scrollbar-width:thin]">
          {BRAND_THEMES.map((t) => (
            <ThemeCard
              key={t.id}
              theme={t}
              active={themeMatches(t, { accent: color, bg, fg, muted })}
              disabled={disabled}
              onApply={() => applyTheme(t)}
            />
          ))}
        </div>
      </section>

      {/* 2 — BRAND BASICS */}
      <Card>
        <CardContent className="grid gap-8 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          {/* Color column */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label
                className="relative size-12 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-border transition-transform hover:scale-105"
                style={{ background: color }}
              >
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setAccent(e.target.value)}
                  disabled={disabled}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Pick accent color"
                />
              </label>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="gallery-hex">Accent color (hex)</Label>
                <Input
                  id="gallery-hex"
                  value={hexInput}
                  onChange={(e) => commitHex(e.target.value)}
                  disabled={disabled}
                  className="font-mono"
                  aria-invalid={!isValidHex(hexInput)}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={disabled}
                  onClick={() => setAccent(c)}
                  className={cn(
                    "size-8 rounded-lg ring-1 ring-border transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-60",
                    eqHex(color, c) && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                  )}
                  style={{ background: c }}
                  aria-label={`Use ${c}`}
                />
              ))}
            </div>

            {/* Auto palettes derived from the accent */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Auto palettes — surfaces matched to your accent
              </p>
              <div className="flex flex-wrap gap-2">
                {palettes.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => applyTheme({ bg: p.bg, fg: p.fg, muted: p.muted })}
                    className={cn(
                      "flex items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-2 text-xs font-medium transition-all hover:-translate-y-0.5 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60",
                      paletteActive(p)
                        ? "border-foreground/60 bg-accent"
                        : "hover:bg-accent/50",
                    )}
                    aria-pressed={paletteActive(p)}
                  >
                    <span className="flex -space-x-1">
                      {[p.bg, p.fg, p.muted].map((c, i) => (
                        <span
                          key={i}
                          className="size-4 rounded-full ring-1 ring-black/10"
                          style={{ background: c, zIndex: 3 - i }}
                        />
                      ))}
                    </span>
                    {p.name}
                    {paletteActive(p) && <Check className="size-3" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Advanced — individual theme tokens */}
            <div className="rounded-lg border bg-muted/20">
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                aria-expanded={advancedOpen}
              >
                <span className="flex items-center gap-1.5">
                  <SlidersHorizontal className="size-3.5" /> Advanced — individual theme colors
                </span>
                <ChevronDown className={cn("size-4 transition-transform duration-200", advancedOpen && "rotate-180")} />
              </button>
              <div
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
                  advancedOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
              >
                <div className="overflow-hidden">
                  <div className="space-y-3 px-3 pb-3">
                    <ColorField label="Background" value={bg} onChange={setBg} disabled={disabled} />
                    <ColorField label="Text" value={fg} onChange={setFg} disabled={disabled} />
                    <ColorField label="Muted text" value={muted} onChange={setMuted} disabled={disabled} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Identity + security column */}
          <div className="space-y-4 md:border-l md:pl-8">
            <div className="space-y-2">
              <Label htmlFor="gallery-logo-text">Logo text (preview fallback)</Label>
              <Input
                id="gallery-logo-text"
                value={logoText}
                onChange={(e) => setLogoText(e.target.value)}
                placeholder="Your brand"
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gallery-staff-pin">Staff PIN</Label>
              <div className="relative">
                <Input
                  id="gallery-staff-pin"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  type={showPin ? "text" : "password"}
                  inputMode="numeric"
                  disabled={disabled}
                  className="pr-10 font-mono tracking-[0.3em]"
                  placeholder="••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((s) => !s)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showPin ? "Hide PIN" : "Show PIN"}
                >
                  {showPin ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Up to 6 digits — unlocks the on-device settings screen.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3 — SCREENS GALLERY */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-medium">Screens</h2>
          <p className="text-sm text-muted-foreground">
            {canEdit
              ? "Click any screen to fine-tune its layout."
              : "Every state your printer can show, live."}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {SCREENS.map((s) => (
            <ScreenCard key={s.value} draft={draft} value={s.value} label={s.label} onOpen={openScreen} />
          ))}
        </div>
      </section>

      {/* 4 — FOCUSED EDITOR DIALOG */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[min(92svh,60rem)] flex-col gap-0 p-0 sm:max-w-[min(96vw,1400px)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3">
              <DialogTitle>{screenLabel}</DialogTitle>
              <span className="rounded-full border px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                {screenIndex + 1} / {SCREENS.length}
              </span>
            </div>
            <DialogDescription className="sr-only">
              Focused editor for the {screenLabel} screen. Drag objects to arrange them; double-click text to edit.
            </DialogDescription>
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="outline" size="icon-sm" onClick={() => stepScreen(-1)} aria-label="Previous screen">
                <ChevronLeft className="size-4" />
              </Button>
              <Button type="button" variant="outline" size="icon-sm" onClick={() => stepScreen(1)} aria-label="Next screen">
                <ChevronRight className="size-4" />
              </Button>
              <Button type="button" size="sm" className="ml-1.5" onClick={() => setEditOpen(false)}>
                <Check className="size-4" /> Done
              </Button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:overflow-hidden">
            {/* Stage — editable canvas */}
            <div className="flex flex-col items-center justify-center gap-3 lg:min-h-0">
              <div className="w-full max-w-[min(100%,calc(92svh-14rem))]">
                <PrinterStage key={screen} editor={editor} brand={printerBrand} />
              </div>
              <p className="text-center text-xs text-muted-foreground">
                {canEdit
                  ? "Drag to arrange — double-click any text to edit it. The QR shown is illustrative."
                  : "View only. The QR shown is illustrative."}
              </p>
            </div>
            {/* Controls */}
            <div className="lg:min-h-0 lg:overflow-y-auto lg:pr-1">
              <PrinterControls editor={editor} onIconUpload={onIconUpload} onImageUpload={onImageUpload} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 5 — STICKY SAVE BAR */}
      <div className="sticky bottom-4 z-30 mt-2 flex items-center justify-between gap-3 rounded-xl border bg-background/85 px-4 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className={cn("size-2 rounded-full", dirty ? "bg-amber-500" : "bg-emerald-500")} />
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} disabled={disabled || !dirty}>
            <RotateCcw className="size-4" /> Reset
          </Button>
          <Button onClick={save} disabled={disabled || !dirty}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saving ? "Saving…" : "Save branding"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A tangible swatch card rendered in the theme's own colors. */
function ThemeCard({
  theme,
  active,
  disabled,
  onApply,
}: {
  theme: BrandTheme;
  active: boolean;
  disabled: boolean;
  onApply: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onApply}
      aria-pressed={active}
      className={cn(
        "w-44 shrink-0 snap-start rounded-xl p-4 text-left ring-1 ring-border transition-all duration-200",
        "hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2",
        active && "shadow-md ring-2",
        disabled && "cursor-not-allowed opacity-60 hover:translate-y-0 hover:shadow-none",
      )}
      style={
        {
          background: theme.bg,
          "--tw-ring-color": active ? theme.accent : undefined,
        } as React.CSSProperties
      }
    >
      <span className="flex items-center justify-between">
        <span className="h-1.5 w-8 rounded-full" style={{ background: theme.accent }} />
        <span
          className={cn(
            "flex size-5 items-center justify-center rounded-full text-white transition-all duration-200",
            active ? "scale-100 opacity-100" : "scale-50 opacity-0",
          )}
          style={{ background: theme.accent }}
          aria-hidden
        >
          <Check className="size-3" />
        </span>
      </span>
      <span className="mt-3 block text-sm font-semibold" style={{ color: theme.fg }}>
        {theme.name}
      </span>
      <span className="mt-1 block text-xs leading-snug" style={{ color: theme.muted }}>
        {theme.description}
      </span>
    </button>
  );
}

/** One live screen thumbnail — click to open the focused editor. */
function ScreenCard({
  draft,
  value,
  label,
  onOpen,
}: {
  draft: BrandingDraft;
  value: PrinterScreen;
  label: string;
  onOpen: (s: PrinterScreen) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(value)}
      aria-label={`${draft.canEdit ? "Edit" : "View"} the ${label} screen`}
      className="group overflow-hidden rounded-xl bg-card text-left ring-1 ring-border transition-all duration-200 hover:-translate-y-1 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative">
        <div className="pointer-events-none">
          <PrinterPreview brand={draft.printerBrand} config={draft.config} screen={value} />
        </div>
        {/* hover affordance */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="flex translate-y-1 items-center gap-1.5 rounded-full bg-background/95 px-3.5 py-1.5 text-sm font-medium shadow-lg backdrop-blur transition-transform duration-200 group-hover:translate-y-0">
            <Pencil className="size-3.5" /> {draft.canEdit ? "Edit screen" : "View screen"}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between border-t px-3 py-2.5">
        <span className="text-sm font-medium">{label}</span>
        <Pencil className="size-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
      </div>
    </button>
  );
}

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

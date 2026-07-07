"use client";

// "Refined two-column" Branding studio variant — evolution, not revolution.
// Keeps the familiar controls-left / preview-right structure of the current
// editor, but drops the accordion + form feel: a curated theme strip on top,
// calm Tabs (Brand / Screen / Security) on the left, and a filmstrip of all
// seven screens under the live stage on the right. Pure layout over
// useBrandingDraft.

import * as React from "react";
import {
  ChevronDown,
  Eye,
  EyeOff,
  LayoutGrid,
  Loader2,
  Lock,
  Maximize2,
  Minus,
  Palette,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  useBrandingDraft,
  SCREENS,
  type BrandingVariantProps,
} from "@/components/branding-studio/use-branding-draft";
import {
  BRAND_THEMES,
  themeMatches,
  derivePalettes,
} from "@/lib/branding-presets";
import {
  PrinterPreview,
  type PrinterScreen,
} from "@/components/device-preview/printer-preview";
import { PrinterStage } from "@/components/device-preview/printer-editor/printer-stage";
import { PrinterControls } from "@/components/device-preview/printer-editor/printer-controls";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  clampZoom,
  zoomToPx,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  ZOOM_DEFAULT,
} from "@/lib/branding-shell";
import { isValidHex } from "@/lib/color";
import { cn } from "@/lib/utils";

/** Quick accent swatches — same seven as the production editor. */
const PRESETS = ["#B4541F", "#3F9D4E", "#1F5C8B", "#E5484D", "#7C5CFC", "#0F766E", "#111827"];

const sameHex = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function BrandingRefinedVariant(props: BrandingVariantProps) {
  const draft = useBrandingDraft(props);
  const {
    color, hexInput, setAccent, commitHex,
    bg, setBg, fg, setFg, muted, setMuted, applyTheme,
    logoText, setLogoText, pin, setPin,
    config, screen, setScreen, editor, onIconUpload, onImageUpload,
    printerBrand, dirty, saving, disabled, canEdit, save, reset,
  } = draft;

  const [tab, setTab] = React.useState("brand");
  const [showPin, setShowPin] = React.useState(false);
  const [zoom, setZoom] = React.useState(ZOOM_DEFAULT);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const stagePx = zoomToPx(zoom);

  const palettes = React.useMemo(() => derivePalettes(color), [color]);
  const activeScreenLabel = SCREENS.find((s) => s.value === screen)?.label ?? "Screen";

  function pickScreen(s: PrinterScreen) {
    setScreen(s);
    setTab("screen"); // make the left panel immediately relevant
  }

  return (
    <div className="relative space-y-6">
      {!canEdit && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" />
          You have view-only access. Only owners and admins can edit branding.
        </div>
      )}

      {/* ── Theme presets strip ─────────────────────────────────────────── */}
      <section aria-label="Theme presets" className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="size-3.5" /> Start from a look
        </p>
        <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pt-1 pb-2">
          {BRAND_THEMES.map((t) => {
            const active = themeMatches(t, { accent: color, bg, fg, muted });
            return (
              <button
                key={t.id}
                type="button"
                disabled={disabled}
                onClick={() => applyTheme(t)}
                className={cn(
                  "w-40 shrink-0 snap-start rounded-xl border p-3 text-left ring-offset-background transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60",
                  active && "ring-2 ring-offset-2",
                )}
                style={{ background: t.bg, "--tw-ring-color": t.accent } as React.CSSProperties}
                aria-pressed={active}
                aria-label={`Apply ${t.name} theme`}
              >
                <span className="flex items-center gap-2">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: t.accent }} />
                  <span className="truncate text-sm font-semibold" style={{ color: t.fg }}>{t.name}</span>
                </span>
                <span className="mt-1 block truncate text-[11px] leading-snug" style={{ color: t.muted }}>
                  {t.description}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
        {/* ── LEFT — tabbed controls ──────────────────────────────────── */}
        <Card className="self-start">
          <CardContent className="pt-6">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full">
                <TabsTrigger value="brand"><Palette /> Brand</TabsTrigger>
                <TabsTrigger value="screen"><LayoutGrid /> Screen</TabsTrigger>
                <TabsTrigger value="security"><ShieldCheck /> Security</TabsTrigger>
              </TabsList>

              {/* Brand */}
              <TabsContent value="brand" className="mt-4 space-y-5">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <label
                      className="relative size-12 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-border"
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
                      <Label htmlFor="refined-hex">Accent color (hex)</Label>
                      <Input
                        id="refined-hex"
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
                          sameHex(color, c) && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                        )}
                        style={{ background: c }}
                        aria-label={`Use ${c}`}
                      />
                    ))}
                  </div>
                </div>

                {/* Auto palettes derived from the accent */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Auto palettes — surfaces matched to your accent
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {palettes.map((p) => {
                      const active = sameHex(p.bg, bg) && sameHex(p.fg, fg) && sameHex(p.muted, muted);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => applyTheme({ bg: p.bg, fg: p.fg, muted: p.muted })}
                          className={cn(
                            "flex items-center gap-2 rounded-full border py-1.5 pr-3 pl-2 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
                            active && "border-foreground/40 bg-accent",
                          )}
                          aria-pressed={active}
                        >
                          <span className="flex -space-x-1">
                            <span className="size-4 rounded-full ring-1 ring-border" style={{ background: p.bg }} />
                            <span className="size-4 rounded-full ring-1 ring-border" style={{ background: p.fg }} />
                            <span className="size-4 rounded-full ring-1 ring-border" style={{ background: p.muted }} />
                          </span>
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Advanced — individual theme tokens */}
                <details className="group rounded-lg border bg-muted/20">
                  <summary className="flex cursor-pointer items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
                    Advanced — fine-tune individual colors
                    <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-3 px-3 pb-3">
                    <ColorField label="Background" value={bg} onChange={setBg} disabled={disabled} />
                    <ColorField label="Text" value={fg} onChange={setFg} disabled={disabled} />
                    <ColorField label="Muted text" value={muted} onChange={setMuted} disabled={disabled} />
                  </div>
                </details>

                <div className="space-y-2">
                  <Label htmlFor="refined-logo-text">Logo text (preview fallback)</Label>
                  <Input
                    id="refined-logo-text"
                    value={logoText}
                    onChange={(e) => setLogoText(e.target.value)}
                    placeholder="Your brand"
                    disabled={disabled}
                  />
                </div>
              </TabsContent>

              {/* Screen */}
              <TabsContent value="screen" className="mt-4 space-y-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">Editing: {activeScreenLabel}</h3>
                  <p className="text-xs text-muted-foreground">
                    Pick another screen in the filmstrip under the preview.
                  </p>
                </div>
                <PrinterControls editor={editor} onIconUpload={onIconUpload} onImageUpload={onImageUpload} />
              </TabsContent>

              {/* Security */}
              <TabsContent value="security" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="refined-staff-pin">Staff PIN</Label>
                  <div className="relative">
                    <Input
                      id="refined-staff-pin"
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
                      className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showPin ? "Hide PIN" : "Show PIN"}
                    >
                      {showPin ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Unlocks on-device settings on your printers. Digits only, up to 6.
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* ── RIGHT — live preview + filmstrip ────────────────────────── */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div className="space-y-1">
                <CardTitle className="text-base">Live preview</CardTitle>
                <CardDescription>4″ printer · 720 × 720 · 100% ≈ actual size</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                <Maximize2 className="size-4" /> Fullscreen
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Zoom */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground">Zoom</span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
                  aria-label="Zoom out"
                  className="flex size-6 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:text-foreground"
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
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
                  aria-label="Zoom in"
                  className="flex size-6 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
                <span className="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground">{zoom}%</span>
              </div>

              {/* Active screen — editable stage, sized by zoom */}
              <div className="mx-auto max-w-full" style={{ width: stagePx }}>
                <PrinterStage editor={editor} brand={printerBrand} />
              </div>

              <p className="text-center text-xs text-muted-foreground">
                {screen === "idle"
                  ? "Drag to arrange the idle screen — double-click any text to edit it."
                  : "The QR shown is illustrative."}
              </p>

              {/* Filmstrip — every screen, live */}
              <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pt-1 pb-1" role="tablist" aria-label="Preview screens">
                {SCREENS.map((s) => {
                  const active = s.value === screen;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => pickScreen(s.value)}
                      className="group w-20 shrink-0 snap-start space-y-1 text-center"
                    >
                      <span
                        className={cn(
                          "block overflow-hidden rounded-md ring-1 ring-border ring-offset-background transition-all group-hover:ring-foreground/40",
                          active && "ring-2 ring-offset-2",
                        )}
                        style={active ? ({ "--tw-ring-color": color } as React.CSSProperties) : undefined}
                      >
                        <span className="pointer-events-none block">
                          <PrinterPreview brand={printerBrand} config={config} screen={s.value} />
                        </span>
                      </span>
                      <span
                        className={cn(
                          "block truncate text-[10px] leading-tight",
                          active ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {s.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Sticky save bar ─────────────────────────────────────────────── */}
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

      {/* ── Fullscreen preview — current screen, clean and large ────────── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-[min(92vw,92vh)]">
          <DialogTitle className="text-base">Preview — {activeScreenLabel}</DialogTitle>
          <div className="mx-auto" style={{ width: "min(86vw, 86vh)" }}>
            <PrinterPreview brand={printerBrand} config={config} screen={screen} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Swatch + hex input for a single theme token (Advanced section). */
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

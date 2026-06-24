"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
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
} from "lucide-react";
import { toast } from "sonner";
import {
  PrinterPreview,
  type PrinterScreen,
  type PrinterBrand,
} from "@/components/device-preview/printer-preview";
import { usePrinterEditor } from "@/components/device-preview/printer-editor/use-printer-editor";
import { PrinterStage } from "@/components/device-preview/printer-editor/printer-stage";
import { PrinterControls } from "@/components/device-preview/printer-editor/printer-controls";
import { type PrinterConfig } from "@/lib/printer-layout";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PreviewCarousel } from "@/components/device-preview/preview-carousel";
import { clampZoom, zoomToPx, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, ZOOM_DEFAULT } from "@/lib/branding-shell";
import { saveBranding } from "@/app/(tenant)/tenant/branding/actions";
import { isValidHex } from "@/lib/color";
import { cn } from "@/lib/utils";

const PRESETS = ["#B4541F", "#3F9D4E", "#1F5C8B", "#E5484D", "#7C5CFC", "#0F766E", "#111827"];

const SCREENS: { value: PrinterScreen; label: string }[] = [
  { value: "idle", label: "Idle / ready" },
  { value: "processing", label: "Processing" },
  { value: "qr", label: "Receipt ready" },
  { value: "sent", label: "Sent ✓" },
  { value: "error", label: "Error / offline" },
  { value: "paused", label: "Paused" },
  { value: "setup", label: "Setup / pairing" },
];

function screenSectionTitle(screen: PrinterScreen): string {
  const label = SCREENS.find((s) => s.value === screen)?.label ?? "Screen";
  return screen === "idle" ? "Idle layout" : `${label} content`;
}

export function BrandingEditor({
  initialColor,
  initialConfig,
  initialBg,
  initialFg,
  initialMuted,
  initialLogoText,
  initialStaffPin,
  storeName,
  canEdit,
}: {
  initialColor: string;
  initialConfig: PrinterConfig;
  initialBg: string;
  initialFg: string;
  initialMuted: string;
  initialLogoText: string;
  initialStaffPin: string;
  storeName: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [color, setColor] = React.useState(initialColor);
  const [hexInput, setHexInput] = React.useState(initialColor);
  const [bg, setBg] = React.useState(initialBg);
  const [fg, setFg] = React.useState(initialFg);
  const [muted, setMuted] = React.useState(initialMuted);
  const [config, setConfig] = React.useState<PrinterConfig>(initialConfig);
  const [logoText, setLogoText] = React.useState(initialLogoText);
  const [pin, setPin] = React.useState(initialStaffPin);
  const [showPin, setShowPin] = React.useState(false);
  const [screen, setScreen] = React.useState<PrinterScreen>("idle");
  const [zoom, setZoom] = React.useState(ZOOM_DEFAULT);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const screenIndex = SCREENS.findIndex((s) => s.value === screen);
  const slidePx = zoomToPx(zoom);
  const [saving, setSaving] = React.useState(false);

  const editor = usePrinterEditor({
    config,
    screen,
    onChange: setConfig,
    disabled: !canEdit,
  });

  const [iconFiles, setIconFiles] = React.useState<Record<string, File>>({});
  const onIconUpload = (objectId: string, file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Icon must be an image."); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Icon must be under 2 MB."); return; }
    setIconFiles((m) => ({ ...m, [objectId]: file }));
    const cur = editor.config.screens[screen].objects.find((o) => o.id === objectId)?.icon ?? { source: "preset" as const };
    editor.patch(objectId, { icon: { ...cur, source: "upload", url: `pending:${objectId}`, signedUrl: URL.createObjectURL(file) } });
  };

  const [imageFiles, setImageFiles] = React.useState<Record<string, File>>({});
  const onImageUpload = (objectId: string, file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Image must be an image."); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Image must be under 2 MB."); return; }
    setImageFiles((m) => ({ ...m, [objectId]: file }));
    editor.patch(objectId, { image: { url: `pending:${objectId}`, signedUrl: URL.createObjectURL(file) } });
  };

  // After router.refresh() re-fetches getTenantBranding, adopt the server truth
  // (real R2 keys + presigned signedUrl), replacing pending blob URLs and clearing dirty.
  React.useEffect(() => { setConfig(initialConfig); setIconFiles({}); setImageFiles({}); }, [initialConfig]);

  const dirty =
    color !== initialColor ||
    bg !== initialBg ||
    fg !== initialFg ||
    muted !== initialMuted ||
    JSON.stringify(config) !== JSON.stringify(initialConfig) ||
    Object.keys(iconFiles).length > 0 ||
    Object.keys(imageFiles).length > 0 ||
    pin !== initialStaffPin;

  function commitHex(v: string) {
    setHexInput(v);
    if (isValidHex(v)) setColor(v.startsWith("#") ? v : `#${v}`);
  }

  function reset() {
    setColor(initialColor);
    setHexInput(initialColor);
    setBg(initialBg);
    setFg(initialFg);
    setMuted(initialMuted);
    setConfig(initialConfig);
    setIconFiles({});
    setImageFiles({});
    setLogoText(initialLogoText);
    setPin(initialStaffPin);
  }

  async function save() {
    if (!isValidHex(hexInput)) {
      toast.error("Enter a valid hex color first.");
      return;
    }
    setSaving(true);
    const fd = new FormData();
    fd.set("brandColor", color);
    fd.set("brandBg", bg);
    fd.set("brandFg", fg);
    fd.set("brandMuted", muted);
    fd.set("printerScreens", JSON.stringify(config));
    for (const [objectId, file] of Object.entries(iconFiles)) fd.set(`icon:${objectId}`, file);
    for (const [objectId, file] of Object.entries(imageFiles)) fd.set(`image:${objectId}`, file);
    fd.set("staffPin", pin);

    const res = await saveBranding(fd);
    setSaving(false);

    if (!res.ok) {
      toast.error("Couldn't save branding", { description: res.error });
      return;
    }
    toast.success("Branding saved", { description: "Your printers will update on next sync." });
    setIconFiles({});
    setImageFiles({});
    router.refresh();
  }

  const disabled = !canEdit || saving;
  const printerBrand: PrinterBrand = {
    brandColor: color,
    brandBg: bg,
    brandFg: fg,
    brandMuted: muted,
    logoText,
    storeName,
  };

  return (
    <div className="relative space-y-6">
      {!canEdit && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" />
          You have view-only access. Only owners and admins can edit branding.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
        {/* LEFT — grouped controls */}
        <Card className="self-start">
          <Accordion type="single" collapsible defaultValue="screen" className="px-4">
            <AccordionItem value="brand">
              <AccordionTrigger>
                <SectionHead icon={Palette} title="Brand" />
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="logoText">Logo text (preview fallback)</Label>
              <Input id="logoText" value={logoText} onChange={(e) => setLogoText(e.target.value)} placeholder="Your brand" disabled={disabled} />
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="relative size-12 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-border" style={{ background: color }}>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => { setColor(e.target.value); setHexInput(e.target.value); }}
                    disabled={disabled}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label="Pick accent color"
                  />
                </label>
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="hex">Accent color (hex)</Label>
                  <Input id="hex" value={hexInput} onChange={(e) => commitHex(e.target.value)} disabled={disabled} className="font-mono" aria-invalid={!isValidHex(hexInput)} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    disabled={disabled}
                    onClick={() => { setColor(c); setHexInput(c); }}
                    className={cn(
                      "size-8 rounded-lg ring-1 ring-border transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-60",
                      color.toLowerCase() === c.toLowerCase() && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                    )}
                    style={{ background: c }}
                    aria-label={`Use ${c}`}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <p className="text-xs font-medium text-muted-foreground">Advanced theme — leave as-is for the default look</p>
              <ColorField label="Background" value={bg} onChange={setBg} disabled={disabled} />
              <ColorField label="Text" value={fg} onChange={setFg} disabled={disabled} />
              <ColorField label="Muted text" value={muted} onChange={setMuted} disabled={disabled} />
            </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="screen">
              <AccordionTrigger>
                <SectionHead icon={LayoutGrid} title={screenSectionTitle(screen)} />
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <PrinterControls editor={editor} onIconUpload={onIconUpload} onImageUpload={onImageUpload} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="security">
              <AccordionTrigger>
                <SectionHead icon={ShieldCheck} title="Security" />
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="space-y-2">
              <Label htmlFor="staffPin">Staff PIN</Label>
              <div className="relative">
                <Input
                  id="staffPin"
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPin ? "Hide PIN" : "Show PIN"}
                >
                  {showPin ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>

        {/* RIGHT — stage */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div className="space-y-1">
                <CardTitle className="text-base">Live preview</CardTitle>
                <CardDescription>4″ printer · 720 × 720 · 100% ≈ actual size</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                  <Maximize2 className="size-4" /> Preview
                </Button>
                <Select value={screen} onValueChange={(v) => setScreen(v as PrinterScreen)}>
                  <SelectTrigger className="w-[150px]" aria-label="Preview screen"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SCREENS.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
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

              <PreviewCarousel
                count={SCREENS.length}
                index={screenIndex < 0 ? 0 : screenIndex}
                onIndexChange={(i) => setScreen(SCREENS[i].value)}
                slideWidthPx={slidePx}
                isDragging={editor.isDragging}
                ariaLabels={SCREENS.map((s) => s.label)}
                renderSlide={(i) =>
                  SCREENS[i].value === screen ? (
                    <PrinterStage editor={editor} brand={printerBrand} />
                  ) : (
                    <PrinterPreview brand={printerBrand} config={config} screen={SCREENS[i].value} />
                  )
                }
              />

              <p className="text-center text-xs text-muted-foreground">
                {screen === "idle"
                  ? "Drag to arrange the idle screen — double-click any text to edit it. Swipe or use the arrows to switch screens."
                  : "Swipe or use the arrows to switch screens. The QR shown is illustrative."}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* STICKY SAVE BAR */}
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

      {/* FULL-SCREEN PREVIEW — the current screen, clean (no editor chrome), large */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-[min(92vw,92vh)]">
          <DialogTitle className="text-base">
            Preview — {SCREENS.find((s) => s.value === screen)?.label ?? "Screen"}
          </DialogTitle>
          <div className="mx-auto" style={{ width: "min(86vw, 86vh)" }}>
            <PrinterPreview brand={printerBrand} config={config} screen={screen} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Icon + title shown inside an accordion trigger. */
function SectionHead({
  icon: Icon,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="text-base font-semibold">{title}</span>
    </span>
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
      <label className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-lg ring-1 ring-border" style={{ background: value }}>
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

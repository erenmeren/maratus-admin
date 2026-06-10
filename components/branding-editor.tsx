"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Eye,
  EyeOff,
  ImageUp,
  LayoutGrid,
  Loader2,
  Lock,
  Palette,
  RotateCcw,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  KioskPreview,
  type KioskScreen,
  type KioskBrand,
} from "@/components/device-preview/kiosk-preview";
import { useKioskEditor } from "@/components/device-preview/kiosk-editor/use-kiosk-editor";
import { KioskStage } from "@/components/device-preview/kiosk-editor/kiosk-stage";
import { KioskControls } from "@/components/device-preview/kiosk-editor/kiosk-controls";
import { type KioskLayout } from "@/lib/kiosk-layout";
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
import { saveBranding } from "@/app/(tenant)/tenant/branding/actions";
import { isValidHex } from "@/lib/color";
import { cn } from "@/lib/utils";

const PRESETS = ["#B4541F", "#3F9D4E", "#1F5C8B", "#E5484D", "#7C5CFC", "#0F766E", "#111827"];

const SCREENS: { value: KioskScreen; label: string }[] = [
  { value: "idle", label: "Idle / ready" },
  { value: "processing", label: "Processing" },
  { value: "qr", label: "Receipt ready" },
  { value: "sent", label: "Sent ✓" },
  { value: "error", label: "Error / offline" },
  { value: "paused", label: "Paused" },
  { value: "setup", label: "Setup / pairing" },
];

export function BrandingEditor({
  initialColor,
  initialLayout,
  initialBg,
  initialFg,
  initialMuted,
  initialLogoText,
  initialLogoUrl,
  initialStaffPin,
  storeName,
  canEdit,
}: {
  initialColor: string;
  initialLayout: KioskLayout;
  initialBg: string;
  initialFg: string;
  initialMuted: string;
  initialLogoText: string;
  initialLogoUrl: string | null;
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
  const [layout, setLayout] = React.useState<KioskLayout>(initialLayout);
  const [logoText, setLogoText] = React.useState(initialLogoText);
  const [logoPreview, setLogoPreview] = React.useState<string | null>(initialLogoUrl);
  const [logoFile, setLogoFile] = React.useState<File | null>(null);
  const [logoCleared, setLogoCleared] = React.useState(false);
  const [pin, setPin] = React.useState(initialStaffPin);
  const [showPin, setShowPin] = React.useState(false);
  const [screen, setScreen] = React.useState<KioskScreen>("idle");
  const [saving, setSaving] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const editor = useKioskEditor({
    layout,
    onChange: setLayout,
    disabled: !canEdit,
  });

  const dirty =
    color !== initialColor ||
    bg !== initialBg ||
    fg !== initialFg ||
    muted !== initialMuted ||
    JSON.stringify(layout) !== JSON.stringify(initialLayout) ||
    pin !== initialStaffPin ||
    logoFile !== null ||
    logoCleared;

  function commitHex(v: string) {
    setHexInput(v);
    if (isValidHex(v)) setColor(v.startsWith("#") ? v : `#${v}`);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Logo must be an image file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2 MB.");
      return;
    }
    setLogoFile(file);
    setLogoCleared(false);
    setLogoPreview(URL.createObjectURL(file));
  }

  function removeLogo() {
    setLogoFile(null);
    setLogoPreview(null);
    setLogoCleared(true);
    if (fileRef.current) fileRef.current.value = "";
  }

  function reset() {
    setColor(initialColor);
    setHexInput(initialColor);
    setBg(initialBg);
    setFg(initialFg);
    setMuted(initialMuted);
    setLayout(initialLayout);
    setLogoText(initialLogoText);
    setLogoPreview(initialLogoUrl);
    setLogoFile(null);
    setLogoCleared(false);
    setPin(initialStaffPin);
    if (fileRef.current) fileRef.current.value = "";
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
    fd.set("kioskLayout", JSON.stringify(layout));
    fd.set("staffPin", pin);
    if (logoFile) fd.set("logo", logoFile);
    fd.set("removeLogo", logoCleared ? "true" : "false");

    const res = await saveBranding(fd);
    setSaving(false);

    if (!res.ok) {
      toast.error("Couldn't save branding", { description: res.error });
      return;
    }
    toast.success("Branding saved", { description: "Your kiosks will update on next sync." });
    setLogoFile(null);
    setLogoCleared(false);
    router.refresh();
  }

  const disabled = !canEdit || saving;
  const kioskBrand: KioskBrand = {
    brandColor: color,
    brandBg: bg,
    brandFg: fg,
    brandMuted: muted,
    logoText,
    logoUrl: logoPreview,
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
        <div className="space-y-6">
          <Section icon={Palette} title="Brand" description="Your logo and colors, shown to customers on the kiosk.">
            {logoPreview ? (
              <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoPreview} alt="Logo preview" className="size-12 rounded-lg object-contain" />
                <div className="flex flex-1 gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => fileRef.current?.click()}>
                    <ImageUp className="size-4" /> Replace
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={removeLogo}>
                    <X className="size-4" /> Remove
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={disabled}
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-8 text-center transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex size-10 items-center justify-center rounded-lg bg-background text-muted-foreground"><ImageUp className="size-5" /></span>
                <span className="text-sm font-medium">Click to upload a logo</span>
                <span className="text-xs text-muted-foreground">PNG or SVG, transparent background recommended</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} disabled={disabled} />

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
          </Section>

          <Section icon={LayoutGrid} title="Idle layout" description="Arrange what customers see on the idle screen.">
            {screen === "idle" ? (
              <KioskControls editor={editor} />
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                Switch the preview to{" "}
                <button type="button" onClick={() => setScreen("idle")} className="font-medium text-foreground underline underline-offset-2">
                  Idle / ready
                </button>{" "}
                to edit the layout.
              </div>
            )}
          </Section>

          <Section icon={ShieldCheck} title="Security" description="Unlocks on-device settings at the kiosk.">
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
          </Section>
        </div>

        {/* RIGHT — stage */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div className="space-y-1">
                <CardTitle className="text-base">Live preview</CardTitle>
                <CardDescription>720 × 720 kiosk display</CardDescription>
              </div>
              <Select value={screen} onValueChange={(v) => setScreen(v as KioskScreen)}>
                <SelectTrigger className="w-[170px]" aria-label="Preview screen"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCREENS.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              <div className="mx-auto w-full max-w-[600px]">
                {screen === "idle" ? (
                  <KioskStage editor={editor} brand={kioskBrand} />
                ) : (
                  <KioskPreview brand={kioskBrand} layout={layout} screen={screen} />
                )}
              </div>
              <p className="mt-4 text-center text-xs text-muted-foreground">
                {screen === "idle"
                  ? "Drag to arrange the idle screen. Other screens preview your theme."
                  : "The QR code shown is illustrative. Real kiosks render a scannable receipt code."}
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
    </div>
  );
}

/** A titled section group with an icon header. */
function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </span>
          <div className="space-y-0.5">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
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

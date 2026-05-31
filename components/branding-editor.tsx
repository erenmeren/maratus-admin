"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ImageUp, Loader2, Lock, RotateCcw, Save, X } from "lucide-react";
import { toast } from "sonner";
import {
  KioskPreview,
  type KioskScreen,
} from "@/components/device-preview/kiosk-preview";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { saveBranding } from "@/app/(tenant)/tenant/branding/actions";
import { isValidHex } from "@/lib/color";
import { cn } from "@/lib/utils";

const PRESETS = ["#B4541F", "#3F9D4E", "#1F5C8B", "#E5484D", "#7C5CFC", "#0F766E", "#111827"];

export function BrandingEditor({
  initialColor,
  initialLogoText,
  initialLogoUrl,
  initialStaffPin,
  storeName,
  canEdit,
}: {
  initialColor: string;
  initialLogoText: string;
  initialLogoUrl: string | null;
  initialStaffPin: string;
  storeName: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [color, setColor] = React.useState(initialColor);
  const [hexInput, setHexInput] = React.useState(initialColor);
  const [logoText, setLogoText] = React.useState(initialLogoText);
  // Preview source (saved presigned URL or a local object URL for a new pick).
  const [logoPreview, setLogoPreview] = React.useState<string | null>(
    initialLogoUrl,
  );
  const [logoFile, setLogoFile] = React.useState<File | null>(null);
  const [logoCleared, setLogoCleared] = React.useState(false);
  const [pin, setPin] = React.useState(initialStaffPin);
  const [showPin, setShowPin] = React.useState(false);
  const [screen, setScreen] = React.useState<KioskScreen>("qr");
  const [saving, setSaving] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Has anything changed from the loaded state?
  const dirty =
    color !== initialColor ||
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
    fd.set("staffPin", pin);
    if (logoFile) fd.set("logo", logoFile);
    fd.set("removeLogo", logoCleared ? "true" : "false");

    const res = await saveBranding(fd);
    setSaving(false);

    if (!res.ok) {
      toast.error("Couldn't save branding", { description: res.error });
      return;
    }
    toast.success("Branding saved", {
      description: "Your kiosks will update on next sync.",
    });
    // Clear local-upload state and re-pull the server (fresh presigned logo URL).
    setLogoFile(null);
    setLogoCleared(false);
    router.refresh();
  }

  const disabled = !canEdit || saving;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Controls */}
      <div className="space-y-6">
        {!canEdit && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Lock className="size-4 shrink-0" />
            You have view-only access. Only owners and admins can edit branding.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Logo</CardTitle>
            <CardDescription>Shown on the kiosk idle and receipt screens.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-8 text-center transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="Logo preview" className="max-h-16 object-contain" />
              ) : (
                <>
                  <span className="flex size-10 items-center justify-center rounded-lg bg-background text-muted-foreground">
                    <ImageUp className="size-5" />
                  </span>
                  <span className="text-sm font-medium">Click to upload a logo</span>
                  <span className="text-xs text-muted-foreground">
                    PNG or SVG, transparent background recommended
                  </span>
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onFile}
              disabled={disabled}
            />
            {logoPreview && (
              <Button
                variant="ghost"
                size="sm"
                onClick={removeLogo}
                disabled={disabled}
                className="w-full"
              >
                <X className="size-4" /> Remove logo
              </Button>
            )}
            <div className="space-y-2">
              <Label htmlFor="logoText">Logo text (preview fallback)</Label>
              <Input
                id="logoText"
                value={logoText}
                onChange={(e) => setLogoText(e.target.value)}
                placeholder="Your brand"
                disabled={disabled}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accent color</CardTitle>
            <CardDescription>
              Your brand color — applied to kiosks only, not the Ditto console.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <label
                className="relative size-12 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-border"
                style={{ background: color }}
              >
                <input
                  type="color"
                  value={color}
                  onChange={(e) => {
                    setColor(e.target.value);
                    setHexInput(e.target.value);
                  }}
                  disabled={disabled}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Pick accent color"
                />
              </label>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="hex">Hex</Label>
                <Input
                  id="hex"
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
                  onClick={() => {
                    setColor(c);
                    setHexInput(c);
                  }}
                  className={cn(
                    "size-8 rounded-lg ring-1 ring-border transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-60",
                    color.toLowerCase() === c.toLowerCase() &&
                      "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                  )}
                  style={{ background: c }}
                  aria-label={`Use ${c}`}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Staff PIN</CardTitle>
            <CardDescription>
              Unlocks on-device settings at the kiosk.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Input
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
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button onClick={save} className="flex-1" disabled={disabled || !dirty}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {saving ? "Saving…" : "Save branding"}
          </Button>
          <Button variant="outline" onClick={reset} disabled={disabled || !dirty}>
            <RotateCcw className="size-4" /> Reset
          </Button>
        </div>
      </div>

      {/* Live preview */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-base">Live preview</CardTitle>
              <CardDescription>720 × 720 kiosk display</CardDescription>
            </div>
            <Tabs value={screen} onValueChange={(v) => setScreen(v as KioskScreen)}>
              <TabsList>
                <TabsTrigger value="idle">Idle</TabsTrigger>
                <TabsTrigger value="qr">Receipt</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            <div className="mx-auto max-w-[420px]">
              <KioskPreview
                brand={{ brandColor: color, logoText, logoUrl: logoPreview, storeName }}
                screen={screen}
              />
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              The QR code shown is illustrative. Real kiosks render a scannable
              receipt code.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

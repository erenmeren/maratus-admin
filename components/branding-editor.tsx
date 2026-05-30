"use client";

import * as React from "react";
import { Eye, EyeOff, ImageUp, RotateCcw, Save, X } from "lucide-react";
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
import { isValidHex } from "@/lib/color";
import { cn } from "@/lib/utils";

const PRESETS = ["#B4541F", "#3F9D4E", "#1F5C8B", "#E5484D", "#7C5CFC", "#0F766E", "#111827"];

export function BrandingEditor({
  initialColor,
  initialLogoText,
  initialStaffPin,
  storeName,
}: {
  initialColor: string;
  initialLogoText: string;
  initialStaffPin: string;
  storeName: string;
}) {
  const [color, setColor] = React.useState(initialColor);
  const [hexInput, setHexInput] = React.useState(initialColor);
  const [logoText, setLogoText] = React.useState(initialLogoText);
  const [logoUrl, setLogoUrl] = React.useState<string | null>(null);
  const [pin, setPin] = React.useState(initialStaffPin);
  const [showPin, setShowPin] = React.useState(false);
  const [screen, setScreen] = React.useState<KioskScreen>("qr");
  const fileRef = React.useRef<HTMLInputElement>(null);

  function commitHex(v: string) {
    setHexInput(v);
    if (isValidHex(v)) setColor(v.startsWith("#") ? v : `#${v}`);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // TODO: replace with API — upload the asset; here we preview locally.
    setLogoUrl(URL.createObjectURL(file));
    toast.success("Logo uploaded", { description: file.name });
  }

  function save() {
    // TODO: replace with API — persist branding for the tenant.
    toast.success("Branding saved", {
      description: "Your kiosks will update on next sync (stub).",
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Controls */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Logo</CardTitle>
            <CardDescription>Shown on the kiosk idle and receipt screens.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-8 text-center transition-colors hover:bg-muted/60"
            >
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Logo preview" className="max-h-16 object-contain" />
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
            />
            {logoUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLogoUrl(null)}
                className="w-full"
              >
                <X className="size-4" /> Remove uploaded logo
              </Button>
            )}
            <div className="space-y-2">
              <Label htmlFor="logoText">Logo text (fallback)</Label>
              <Input
                id="logoText"
                value={logoText}
                onChange={(e) => setLogoText(e.target.value)}
                placeholder="Your brand"
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
                  onClick={() => {
                    setColor(c);
                    setHexInput(c);
                  }}
                  className={cn(
                    "size-8 rounded-lg ring-1 ring-border transition-transform hover:scale-110",
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
          <Button onClick={save} className="flex-1">
            <Save className="size-4" /> Save branding
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setColor(initialColor);
              setHexInput(initialColor);
              setLogoText(initialLogoText);
              setLogoUrl(null);
              setPin(initialStaffPin);
            }}
          >
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
                brand={{ brandColor: color, logoText, logoUrl, storeName }}
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

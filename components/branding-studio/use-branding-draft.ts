"use client";

// Shared draft state for the Branding studio layout variants. Owns every piece
// of editable branding state (colors, per-screen layout config, PIN, pending
// uploads), the printer editor instance, and the save/reset lifecycle — so a
// layout variant is purely presentation over this hook.

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  type PrinterScreen,
  type PrinterBrand,
} from "@/components/device-preview/printer-preview";
import { usePrinterEditor, type PrinterEditor } from "@/components/device-preview/printer-editor/use-printer-editor";
import { type PrinterConfig } from "@/lib/printer-layout";
import { saveBranding } from "@/app/(tenant)/tenant/branding/actions";
import { isValidHex } from "@/lib/color";

/** Server-provided initial values — identical across all layout variants. */
export interface BrandingVariantProps {
  initialColor: string;
  initialConfig: PrinterConfig;
  initialBg: string;
  initialFg: string;
  initialMuted: string;
  initialLogoText: string;
  initialStaffPin: string;
  storeName: string;
  canEdit: boolean;
}

export const SCREENS: { value: PrinterScreen; label: string }[] = [
  { value: "idle", label: "Idle / ready" },
  { value: "processing", label: "Processing" },
  { value: "qr", label: "Document ready" },
  { value: "sent", label: "Sent ✓" },
  { value: "error", label: "Error / offline" },
  { value: "paused", label: "Paused" },
  { value: "setup", label: "Setup / pairing" },
];

export interface BrandingDraft {
  // Colors
  color: string;
  hexInput: string;
  setAccent: (hex: string) => void;
  commitHex: (raw: string) => void;
  bg: string;
  setBg: (v: string) => void;
  fg: string;
  setFg: (v: string) => void;
  muted: string;
  setMuted: (v: string) => void;
  /** Apply a complete theme (preset or derived palette) in one shot. */
  applyTheme: (t: { accent?: string; bg: string; fg: string; muted: string }) => void;
  // Identity / security
  logoText: string;
  setLogoText: (v: string) => void;
  pin: string;
  setPin: (v: string) => void;
  // Layout config + editor
  config: PrinterConfig;
  screen: PrinterScreen;
  setScreen: (s: PrinterScreen) => void;
  editor: PrinterEditor;
  onIconUpload: (objectId: string, file: File) => void;
  onImageUpload: (objectId: string, file: File) => void;
  // Preview
  printerBrand: PrinterBrand;
  // Lifecycle
  dirty: boolean;
  saving: boolean;
  disabled: boolean;
  canEdit: boolean;
  storeName: string;
  save: () => Promise<void>;
  reset: () => void;
}

export function useBrandingDraft({
  initialColor,
  initialConfig,
  initialBg,
  initialFg,
  initialMuted,
  initialLogoText,
  initialStaffPin,
  storeName,
  canEdit,
}: BrandingVariantProps): BrandingDraft {
  const router = useRouter();
  const [color, setColor] = React.useState(initialColor);
  const [hexInput, setHexInput] = React.useState(initialColor);
  const [bg, setBg] = React.useState(initialBg);
  const [fg, setFg] = React.useState(initialFg);
  const [muted, setMuted] = React.useState(initialMuted);
  const [config, setConfig] = React.useState<PrinterConfig>(initialConfig);
  const [logoText, setLogoText] = React.useState(initialLogoText);
  const [pin, setPin] = React.useState(initialStaffPin);
  const [screen, setScreen] = React.useState<PrinterScreen>("idle");
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

  // After router.refresh() re-fetches branding, adopt the server truth (real R2
  // keys + presigned signedUrl), replacing pending blob URLs and clearing dirty.
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

  function setAccent(hex: string) {
    setColor(hex);
    setHexInput(hex);
  }

  function commitHex(raw: string) {
    setHexInput(raw);
    if (isValidHex(raw)) setColor(raw.startsWith("#") ? raw : `#${raw}`);
  }

  function applyTheme(t: { accent?: string; bg: string; fg: string; muted: string }) {
    if (t.accent) setAccent(t.accent);
    setBg(t.bg);
    setFg(t.fg);
    setMuted(t.muted);
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

  return {
    color,
    hexInput,
    setAccent,
    commitHex,
    bg,
    setBg,
    fg,
    setFg,
    muted,
    setMuted,
    applyTheme,
    logoText,
    setLogoText,
    pin,
    setPin,
    config,
    screen,
    setScreen,
    editor,
    onIconUpload,
    onImageUpload,
    printerBrand: { brandColor: color, brandBg: bg, brandFg: fg, brandMuted: muted, logoText, storeName },
    dirty,
    saving,
    disabled: !canEdit || saving,
    canEdit,
    storeName,
    save,
    reset,
  };
}

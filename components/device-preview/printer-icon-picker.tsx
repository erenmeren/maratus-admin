"use client";

import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ICON_PRESETS, type PrinterIcon, type IconPreset, type IconTint } from "@/lib/printer-layout";
import { ICON_COMPONENTS } from "@/lib/printer-icons";
import { cn } from "@/lib/utils";

const TINTS: { value: IconTint; label: string }[] = [
  { value: "accent", label: "Accent" },
  { value: "muted", label: "Muted" },
  { value: "warn", label: "Warn" },
  { value: "none", label: "None" },
];

export function PrinterIconPicker({
  icon,
  disabled,
  onChange,
}: {
  icon: PrinterIcon;
  disabled?: boolean;
  onChange: (next: PrinterIcon) => void;
}) {
  const Active = ICON_COMPONENTS[(icon.preset ?? "check") as IconPreset];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} className="gap-2">
          {/* Legacy layouts may still carry an uploaded icon; picking a preset replaces it. */}
          {icon.source === "upload" ? <span className="text-xs">Custom image</span> : <Active className="size-4" />}
          Choose icon
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3">
        <div className="grid grid-cols-6 gap-1.5">
          {ICON_PRESETS.map((name) => {
            const Glyph = ICON_COMPONENTS[name];
            const active = icon.source === "preset" && icon.preset === name;
            return (
              <button
                key={name}
                type="button"
                aria-label={name}
                onClick={() => onChange({ ...icon, source: "preset", preset: name })}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-md border text-muted-foreground hover:bg-accent",
                  active && "border-foreground text-foreground ring-1 ring-foreground",
                )}
              >
                <Glyph className="size-4" />
              </button>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Tint</p>
          <div className="flex gap-1">
            {TINTS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => onChange({ ...icon, tint: t.value })}
                className={cn("flex-1 rounded-md border px-1 py-1 text-xs hover:bg-accent", (icon.tint ?? "accent") === t.value && "border-foreground ring-1 ring-foreground")}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between text-xs">
          <span className="font-medium text-muted-foreground">Circle background</span>
          <input type="checkbox" checked={!!icon.circle} onChange={(e) => onChange({ ...icon, circle: e.target.checked })} />
        </label>
      </PopoverContent>
    </Popover>
  );
}

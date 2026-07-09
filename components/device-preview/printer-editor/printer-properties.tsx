"use client";

import * as React from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowUpToLine, Trash2, Wifi } from "lucide-react";
import {
  objectLabel,
  FONT_MIN,
  FONT_MAX,
  MAX_TEXT_LEN,
  type PrinterObject,
  type TextAlign,
} from "@/lib/printer-layout";
import { MIN_BOX } from "@/lib/printer-geometry";
import type { PrinterEditor } from "./use-printer-editor";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIMEZONES } from "@/lib/timezones";
import { cn } from "@/lib/utils";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const CANVAS_REF_PX = 720;

/** The type-aware property controls for one object — shared by every
 *  properties-display variant (rail panel, inline row, drill-in view,
 *  floating card, bottom bar). `dense` lays fields out in a wrappable
 *  horizontal row for the bottom-bar variant. */
export function PropertyFields({
  object,
  editor,
  onImageUpload,
  dense = false,
}: {
  object: PrinterObject;
  editor: PrinterEditor;
  onImageUpload: (objectId: string, file: File) => void;
  dense?: boolean;
}) {
  const { disabled } = editor;
  const set = (p: Partial<PrinterObject>) => editor.patch(object.id, p);

  const xywh = (
    <>
      <NumberField label="X" value={Math.round(object.x * CANVAS_REF_PX)} disabled={disabled} onChange={(v) => set({ x: clamp(v / CANVAS_REF_PX, 0, 1 - object.w) })} className={dense ? "w-14" : undefined} />
      <NumberField label="Y" value={Math.round(object.y * CANVAS_REF_PX)} disabled={disabled} onChange={(v) => set({ y: clamp(v / CANVAS_REF_PX, 0, 1 - object.h) })} className={dense ? "w-14" : undefined} />
      <NumberField label="W" value={Math.round(object.w * CANVAS_REF_PX)} disabled={disabled} onChange={(v) => set({ w: clamp(v / CANVAS_REF_PX, MIN_BOX, 1 - object.x) })} className={dense ? "w-14" : undefined} />
      <NumberField label="H" value={Math.round(object.h * CANVAS_REF_PX)} disabled={disabled} onChange={(v) => set({ h: clamp(v / CANVAS_REF_PX, MIN_BOX, 1 - object.y) })} className={dense ? "w-14" : undefined} />
    </>
  );

  return (
    <div className={dense ? "flex flex-wrap items-end gap-x-3 gap-y-2" : "space-y-3"}>
      {object.type === "text" && (
        <>
          <div className={cn("space-y-1.5", dense && "w-44 space-y-1")}>
            <Label className={cn("text-muted-foreground", dense ? "text-[10px]" : "text-xs")}>Text</Label>
            <Input value={object.text ?? ""} disabled={disabled} maxLength={MAX_TEXT_LEN} onChange={(e) => set({ text: e.target.value })} className="h-8" />
          </div>
          {dense ? (
            <>
              <NumberField label="Font size" value={Math.round(object.fontSize ?? 24)} disabled={disabled} onChange={(v) => set({ fontSize: clamp(v, FONT_MIN, FONT_MAX) })} className="w-16" />
              <AlignPicker value={object.align ?? "center"} disabled={disabled} onChange={(a) => set({ align: a })} className="w-28" />
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Font size" value={Math.round(object.fontSize ?? 24)} disabled={disabled} onChange={(v) => set({ fontSize: clamp(v, FONT_MIN, FONT_MAX) })} />
              <AlignPicker value={object.align ?? "center"} disabled={disabled} onChange={(a) => set({ align: a })} />
            </div>
          )}
        </>
      )}

      {object.type === "image" && (
        <div className={cn("space-y-1.5", dense && "w-44 space-y-1")}>
          <Label className={cn("text-muted-foreground", dense ? "text-[10px]" : "text-xs")}>Image</Label>
          <ImageUploadField
            url={object.image?.signedUrl ?? object.image?.url ?? null}
            disabled={disabled}
            dense={dense}
            onUpload={(file) => onImageUpload(object.id, file)}
          />
        </div>
      )}

      {dense ? xywh : (
        <>
          <div className="grid grid-cols-4 gap-2">{xywh}</div>
          <p className="text-[10px] text-muted-foreground">Pixels on the 720 × 720 printer canvas.</p>
        </>
      )}

      {object.type === "clock" && (
        <>
          <div className={cn("space-y-1.5", dense ? "w-40 space-y-1" : undefined)}>
            <Label className={cn("text-muted-foreground", dense ? "text-[10px]" : "text-xs")}>Timezone</Label>
            <Select value={editor.config.clockTimezone} onValueChange={(v) => editor.setShared({ clockTimezone: v })} disabled={disabled}>
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (<SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <SwitchField dense={dense} id={`clock-24h-${object.id}`} label="24-hour" checked={editor.config.clock24h} disabled={disabled} onChange={(v) => editor.setShared({ clock24h: v })} />
          <AlignPicker value={object.align ?? "center"} disabled={disabled} onChange={(a) => set({ align: a })} className={dense ? "w-28" : undefined} />
          <SwitchField dense={dense} id={`clock-show-date-${object.id}`} label="Show date" checked={object.clock?.showDate ?? true} disabled={disabled} onChange={(v) => set({ clock: { ...(object.clock ?? {}), showDate: v } })} />
          <SwitchField dense={dense} id={`clock-show-weekday-${object.id}`} label="Show weekday" checked={object.clock?.showWeekday ?? true} disabled={disabled || !(object.clock?.showDate ?? true)} onChange={(v) => set({ clock: { ...(object.clock ?? {}), showWeekday: v } })} />
        </>
      )}

      {object.type === "wifi" && (
        <div className={cn("space-y-1.5", dense && "w-40 space-y-1")}>
          <Label className={cn("flex items-center gap-1.5 text-muted-foreground", dense ? "text-[10px]" : "text-xs")}><Wifi className="size-3.5" /> Signal level</Label>
          <div className="flex gap-1.5">
            {[0, 1, 2, 3, 4].map((lvl) => (
              <button
                key={lvl}
                type="button"
                disabled={disabled}
                onClick={() => editor.setShared({ wifiLevel: lvl })}
                className={cn("h-8 flex-1 rounded-md border text-xs font-medium transition-colors disabled:opacity-50", editor.config.wifiLevel === lvl ? "border-foreground bg-foreground text-background" : "hover:bg-accent")}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>
      )}

      {object.type === "countdown" && (
        <p className={cn("text-xs text-muted-foreground", dense && "max-w-56 self-center")}>
          The QR code&apos;s visible duration is set in <span className="font-medium">Device Settings</span>.
        </p>
      )}
    </div>
  );
}

/** Left / center / right alignment segmented control. */
function AlignPicker({
  value,
  disabled,
  onChange,
  className,
}: {
  value: TextAlign;
  disabled?: boolean;
  onChange: (a: TextAlign) => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-[10px] text-muted-foreground">Align</Label>
      <div className="flex gap-1">
        {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as [TextAlign, typeof AlignLeft][]).map(([a, Icon]) => (
          <button
            key={a}
            type="button"
            disabled={disabled}
            onClick={() => onChange(a)}
            aria-label={`Align ${a}`}
            className={cn("flex h-8 flex-1 items-center justify-center rounded-md border transition-colors disabled:opacity-50", value === a ? "border-foreground bg-foreground text-background" : "hover:bg-accent")}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Labelled switch: stacked label-over-switch when dense, spread row otherwise. */
function SwitchField({
  id,
  label,
  checked,
  disabled,
  onChange,
  dense,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  dense?: boolean;
}) {
  if (dense) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Label htmlFor={id} className="whitespace-nowrap text-[10px] text-muted-foreground">{label}</Label>
        <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="mb-1" />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/** Small labelled numeric input. Buffers keystrokes; commits on blur/Enter. */
export function NumberField({
  label,
  value,
  disabled,
  onChange,
  className,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = React.useState<string>(value.toString());
  const [focused, setFocused] = React.useState(false);

  React.useEffect(() => {
    if (!focused) setDraft(value.toString());
  }, [value, focused]);

  const commit = () => {
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n)) onChange(n);
    else setDraft(value.toString());
  };

  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        inputMode="numeric"
        value={draft}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => { if (e.key === "Enter") { commit(); (e.currentTarget as HTMLInputElement).blur(); } }}
        className="h-8 px-2 font-mono text-xs tabular-nums [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </div>
  );
}

export function ImageUploadField({
  url,
  disabled,
  onUpload,
  dense,
}: {
  url: string | null;
  disabled?: boolean;
  onUpload: (file: File) => void;
  dense?: boolean;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className={dense ? "flex items-center gap-2" : "space-y-2"}>
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className={cn("rounded-md border object-contain", dense ? "size-8" : "h-16 w-full")} />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => fileRef.current?.click()}
        className={cn("rounded-md border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50", dense ? "h-8 min-w-0 flex-1 truncate py-0" : "w-full")}
      >
        {url ? "Replace image" : "Upload image (≤ 2 MB)"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Stage overlay variants — rendered over the canvas, not in the rail        */
/* ------------------------------------------------------------------------ */

/** Header actions shared by the stage overlays: bring-to-front + delete. */
function OverlayActions({ object, editor }: { object: PrinterObject; editor: PrinterEditor }) {
  const { disabled } = editor;
  const deletable = object.type === "text" || object.type === "icon" || object.type === "image";
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => editor.bringToFront(object.id)}
        title="Bring to front"
        aria-label="Bring to front"
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <ArrowUpToLine className="size-3.5" />
      </button>
      {deletable && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.removeObject(object.id)}
          title="Delete"
          aria-label={`Delete ${objectLabel(object)}`}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-destructive disabled:opacity-50"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Variant C — floating card pinned next to the selected object on the canvas.
 *  Must be rendered inside a `relative` wrapper that exactly matches the
 *  canvas bounds (the zoomed preview wrapper). */
export function FloatingProperties({
  editor,
  onImageUpload,
}: {
  editor: PrinterEditor;
  onImageUpload: (objectId: string, file: File) => void;
}) {
  const { selected } = editor;
  if (!selected || !selected.visible) return null;

  // Sit beside the object: right of it when there's room, otherwise left.
  const onRight = selected.x + selected.w <= 0.55;
  const style: React.CSSProperties = {
    top: `${clamp(selected.y, 0, 0.5) * 100}%`,
    ...(onRight
      ? { left: `calc(${(selected.x + selected.w) * 100}% + 14px)` }
      : { right: `calc(${(1 - selected.x) * 100}% + 14px)` }),
  };

  return (
    <div
      key={selected.id}
      style={style}
      className="absolute z-30 w-64 rounded-xl border bg-card p-3 shadow-2xl dark:border-white/10"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {objectLabel(selected)}
        </span>
        <OverlayActions object={selected} editor={editor} />
      </div>
      <PropertyFields object={selected} editor={editor} onImageUpload={onImageUpload} />
    </div>
  );
}

/** Variant D — contextual bar docked at the bottom of the stage, zoom-pill
 *  style. Rendered inside the stage's canvas-area container. */
export function BottomBarProperties({
  editor,
  onImageUpload,
}: {
  editor: PrinterEditor;
  onImageUpload: (objectId: string, file: File) => void;
}) {
  const { selected } = editor;
  if (!selected || !selected.visible) return null;

  return (
    <div
      key={selected.id}
      className="absolute bottom-4 left-1/2 z-30 w-max max-w-[min(56rem,calc(100%-2rem))] -translate-x-1/2 overflow-x-auto rounded-2xl border bg-card px-4 py-3 shadow-2xl dark:border-white/10 lg:left-[calc(50%+10.75rem)] lg:max-w-[min(56rem,calc(100%-23.5rem))]"
    >
      <div className="flex items-end gap-3">
        <div className="flex shrink-0 flex-col items-start gap-1 self-center">
          <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {objectLabel(selected)}
          </span>
          <OverlayActions object={selected} editor={editor} />
        </div>
        <div className="h-12 w-px shrink-0 self-center bg-border" />
        <div className="min-w-0 flex-1">
          <PropertyFields dense object={selected} editor={editor} onImageUpload={onImageUpload} />
        </div>
      </div>
    </div>
  );
}

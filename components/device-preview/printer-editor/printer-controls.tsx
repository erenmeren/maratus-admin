"use client";

import * as React from "react";
import { AlignCenter, AlignLeft, AlignRight, Eye, EyeOff, Plus, RotateCcw, Trash2, Wifi } from "lucide-react";
import {
  objectLabel,
  FONT_MIN,
  FONT_MAX,
  MAX_CUSTOM,
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
import { PrinterIconPicker } from "@/components/device-preview/printer-icon-picker";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const CANVAS_REF_PX = 720;

/** Object list + a type-aware properties panel for the selected object.
 *  Styled narrow-first: it lives in the Branding studio's ~19rem control rail. */
export function PrinterControls({ editor, onImageUpload }: { editor: PrinterEditor; onImageUpload: (objectId: string, file: File) => void }) {
  const { ordered, disabled, selectedId, setSelectedId, selected, atCustomCap } = editor;

  const addButtons: { label: string; onClick: () => void; capped: boolean; show: boolean }[] = [
    { label: "Text", onClick: editor.addText, capped: atCustomCap, show: true },
    { label: "Icon", onClick: editor.addIcon, capped: atCustomCap, show: true },
    { label: "Image", onClick: editor.addImage, capped: atCustomCap, show: true },
    { label: "Brand name", onClick: editor.addBrandName, capped: false, show: !editor.hasBrandName },
  ];

  return (
    <div className="space-y-4">
      {/* Add objects */}
      <div className="grid grid-cols-2 gap-1.5">
        {addButtons.filter((b) => b.show).map((b) => (
          <button
            key={b.label}
            type="button"
            disabled={disabled || b.capped}
            onClick={b.onClick}
            title={b.capped ? `Limit of ${MAX_CUSTOM} custom objects reached` : undefined}
            className="flex h-8 min-w-0 items-center justify-center gap-1 rounded-md border text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Plus className="size-3.5 shrink-0" />
            <span className="truncate">{b.label}</span>
          </button>
        ))}
      </div>

      {/* Object list */}
      <div className="overflow-hidden rounded-lg border">
        {ordered.map((o, i) => {
          const active = selectedId === o.id;
          return (
            <div
              key={o.id}
              onClick={() => o.visible && setSelectedId(o.id)}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 transition-colors",
                i > 0 && "border-t border-border/60",
                active ? "bg-accent" : o.visible && "hover:bg-accent/50",
                o.visible && "cursor-pointer",
              )}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={(ev) => { ev.stopPropagation(); editor.patch(o.id, { visible: !o.visible }); }}
                className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                aria-label={o.visible ? `Hide ${objectLabel(o)}` : `Show ${objectLabel(o)}`}
              >
                {o.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              </button>
              <span className={cn("min-w-0 flex-1 truncate text-[13px] font-medium", !o.visible && "text-muted-foreground line-through")}>
                {objectLabel(o)}
              </span>
              {(o.type === "text" || o.type === "icon" || o.type === "image" || o.type === "logo") && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(ev) => { ev.stopPropagation(); editor.removeObject(o.id); }}
                  className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                  aria-label={`Delete ${objectLabel(o)}`}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {selected && <Properties key={selected.id} object={selected} editor={editor} onImageUpload={onImageUpload} />}

      <button
        type="button"
        disabled={disabled}
        onClick={editor.resetLayout}
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <RotateCcw className="size-3.5" /> Reset layout to default
      </button>
    </div>
  );
}

/** Type-aware properties for the selected object. */
function Properties({ object, editor, onImageUpload }: { object: PrinterObject; editor: PrinterEditor; onImageUpload: (objectId: string, file: File) => void }) {
  const { disabled } = editor;
  const set = (p: Partial<PrinterObject>) => editor.patch(object.id, p);

  return (
    <div className="space-y-3 rounded-lg bg-muted/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {objectLabel(object)}
        </span>
        <button type="button" disabled={disabled} onClick={() => editor.bringToFront(object.id)} className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
          Bring to front
        </button>
      </div>

      {object.type === "text" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Text</Label>
            <Input value={object.text ?? ""} disabled={disabled} maxLength={MAX_TEXT_LEN} onChange={(e) => set({ text: e.target.value })} className="h-8" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Font size" value={Math.round(object.fontSize ?? 24)} disabled={disabled} onChange={(v) => set({ fontSize: clamp(v, FONT_MIN, FONT_MAX) })} />
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Align</Label>
              <div className="flex gap-1">
                {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as [TextAlign, typeof AlignLeft][]).map(([a, Icon]) => (
                  <button
                    key={a}
                    type="button"
                    disabled={disabled}
                    onClick={() => set({ align: a })}
                    aria-label={`Align ${a}`}
                    className={cn("flex h-8 flex-1 items-center justify-center rounded-md border transition-colors disabled:opacity-50", (object.align ?? "center") === a ? "border-foreground bg-foreground text-background" : "hover:bg-accent")}
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {object.type === "icon" && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Icon</Label>
          <PrinterIconPicker
            icon={object.icon ?? { source: "preset", preset: "check", tint: "accent" }}
            disabled={disabled}
            onChange={(next) => set({ icon: next })}
          />
        </div>
      )}

      {object.type === "image" && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Image</Label>
          <ImageUploadField
            url={object.image?.signedUrl ?? object.image?.url ?? null}
            disabled={disabled}
            onUpload={(file) => onImageUpload(object.id, file)}
          />
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        <NumberField label="X" value={Math.round(object.x * CANVAS_REF_PX)} disabled={disabled} onChange={(v) => set({ x: clamp(v / CANVAS_REF_PX, 0, 1 - object.w) })} />
        <NumberField label="Y" value={Math.round(object.y * CANVAS_REF_PX)} disabled={disabled} onChange={(v) => set({ y: clamp(v / CANVAS_REF_PX, 0, 1 - object.h) })} />
        <NumberField label="W" value={Math.round(object.w * CANVAS_REF_PX)} disabled={disabled} onChange={(v) => set({ w: clamp(v / CANVAS_REF_PX, MIN_BOX, 1 - object.x) })} />
        <NumberField label="H" value={Math.round(object.h * CANVAS_REF_PX)} disabled={disabled} onChange={(v) => set({ h: clamp(v / CANVAS_REF_PX, MIN_BOX, 1 - object.y) })} />
      </div>
      <p className="text-[10px] text-muted-foreground">Pixels on the 720 × 720 printer canvas.</p>

      {object.type === "clock" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Timezone</Label>
              <Select value={editor.config.clockTimezone} onValueChange={(v) => editor.setShared({ clockTimezone: v })} disabled={disabled}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (<SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="clock-24h" className="text-xs text-muted-foreground">24-hour</Label>
              <Switch id="clock-24h" checked={editor.config.clock24h} onCheckedChange={(v) => editor.setShared({ clock24h: v })} disabled={disabled} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Align</Label>
            <div className="flex gap-1">
              {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as [TextAlign, typeof AlignLeft][]).map(([a, Icon]) => (
                <button
                  key={a}
                  type="button"
                  disabled={disabled}
                  onClick={() => set({ align: a })}
                  aria-label={`Align ${a}`}
                  className={cn("flex h-8 flex-1 items-center justify-center rounded-md border transition-colors disabled:opacity-50", (object.align ?? "center") === a ? "border-foreground bg-foreground text-background" : "hover:bg-accent")}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="clock-show-date" className="text-xs text-muted-foreground">Show date</Label>
            <Switch
              id="clock-show-date"
              checked={object.clock?.showDate ?? true}
              onCheckedChange={(v) => set({ clock: { ...(object.clock ?? {}), showDate: v } })}
              disabled={disabled}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="clock-show-weekday" className="text-xs text-muted-foreground">Show weekday</Label>
            <Switch
              id="clock-show-weekday"
              checked={object.clock?.showWeekday ?? true}
              onCheckedChange={(v) => set({ clock: { ...(object.clock ?? {}), showWeekday: v } })}
              disabled={disabled || !(object.clock?.showDate ?? true)}
            />
          </div>
        </>
      )}

      {object.type === "wifi" && (
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Wifi className="size-3.5" /> Signal level</Label>
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
        <p className="text-xs text-muted-foreground">
          The QR code's visible duration is set in <span className="font-medium">Device Settings</span>.
        </p>
      )}
    </div>
  );
}

/** Small labelled numeric input. Buffers keystrokes; commits on blur/Enter. */
function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
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
    <div className="space-y-1">
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
        className="h-8 px-2 font-mono text-xs tabular-nums"
      />
    </div>
  );
}

function ImageUploadField({ url, disabled, onUpload }: { url: string | null; disabled?: boolean; onUpload: (file: File) => void }) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-16 w-full rounded-md border object-contain" />
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
        className="w-full rounded-md border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
      >
        {url ? "Replace image" : "Upload image (≤ 2 MB)"}
      </button>
    </div>
  );
}

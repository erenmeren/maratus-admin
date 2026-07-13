"use client";

import * as React from "react";
import { AlignCenter, AlignLeft, AlignRight, Wifi } from "lucide-react";
import {
  FONT_MIN,
  FONT_MAX,
  MAX_TEXT_LEN,
  MAX_NAME_LEN,
  TYPE_LABEL,
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

/** The type-aware property controls for the selected object, rendered inline
 *  under its row in the object list. */
export function PropertyFields({
  object,
  editor,
  onImageUpload,
}: {
  object: PrinterObject;
  editor: PrinterEditor;
  onImageUpload: (objectId: string, file: File) => void;
}) {
  const { disabled } = editor;
  const set = (p: Partial<PrinterObject>) => editor.patch(object.id, p);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Name</Label>
        <Input
          value={object.name ?? ""}
          disabled={disabled}
          maxLength={MAX_NAME_LEN}
          placeholder={TYPE_LABEL[object.type]}
          onChange={(e) => set({ name: e.target.value || undefined })}
          className="h-8"
        />
      </div>

      {object.type === "text" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Text</Label>
            <Input value={object.text ?? ""} disabled={disabled} maxLength={MAX_TEXT_LEN} onChange={(e) => set({ text: e.target.value })} className="h-8" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Font size" value={Math.round(object.fontSize ?? 24)} disabled={disabled} onChange={(v) => set({ fontSize: clamp(v, FONT_MIN, FONT_MAX) })} />
            <AlignPicker value={object.align ?? "center"} disabled={disabled} onChange={(a) => set({ align: a })} />
          </div>
        </>
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
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Timezone</Label>
            <Select value={editor.config.clockTimezone} onValueChange={(v) => editor.setShared({ clockTimezone: v })} disabled={disabled}>
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (<SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <SwitchField id={`clock-24h-${object.id}`} label="24-hour" checked={editor.config.clock24h} disabled={disabled} onChange={(v) => editor.setShared({ clock24h: v })} />
          <AlignPicker value={object.align ?? "center"} disabled={disabled} onChange={(a) => set({ align: a })} />
          <SwitchField id={`clock-show-date-${object.id}`} label="Show date" checked={object.clock?.showDate ?? true} disabled={disabled} onChange={(v) => set({ clock: { ...(object.clock ?? {}), showDate: v } })} />
          <SwitchField id={`clock-show-weekday-${object.id}`} label="Show weekday" checked={object.clock?.showWeekday ?? true} disabled={disabled || !(object.clock?.showDate ?? true)} onChange={(v) => set({ clock: { ...(object.clock ?? {}), showWeekday: v } })} />
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
}: {
  value: TextAlign;
  disabled?: boolean;
  onChange: (a: TextAlign) => void;
}) {
  return (
    <div className="space-y-1">
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

/** Labelled switch row: label left, switch right. */
function SwitchField({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
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
        className="h-8 px-2 font-mono text-xs tabular-nums [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </div>
  );
}

function ImageUploadField({
  url,
  disabled,
  onUpload,
}: {
  url: string | null;
  disabled?: boolean;
  onUpload: (file: File) => void;
}) {
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

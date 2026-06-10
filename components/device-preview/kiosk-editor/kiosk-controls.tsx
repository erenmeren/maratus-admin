"use client";

import * as React from "react";
import { Eye, EyeOff, Plus, RotateCcw, Trash2, Wifi } from "lucide-react";
import {
  elementLabel,
  MAX_CUSTOM,
  MAX_TEXT_LEN,
  SCALE_MIN,
  SCALE_MAX,
  type KioskElement,
} from "@/lib/kiosk-layout";
import type { KioskEditor } from "./use-kiosk-editor";
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
const CANVAS_REF_PX = 720; // design reference for pixel readouts

/** All idle-layout controls (element list, inspector, clock/wifi, reset). */
export function KioskControls({ editor }: { editor: KioskEditor }) {
  const { layout, onChange, disabled, ordered, selectedId, setSelectedId, selected, atCustomCap } = editor;

  return (
    <div className="space-y-4">
      {/* Add / element list */}
      <div className="space-y-2 rounded-xl border p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Elements</span>
          <button
            type="button"
            disabled={disabled || atCustomCap}
            onClick={editor.addText}
            title={atCustomCap ? `Limit of ${MAX_CUSTOM} custom text elements reached` : undefined}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Plus className="size-3.5" /> Add text
          </button>
        </div>
        {ordered.map((e) => {
          const active = selectedId === e.id;
          return (
            <div
              key={e.id}
              onClick={() => e.visible && setSelectedId(e.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors",
                active && "bg-accent",
                e.visible && "cursor-pointer",
              )}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={(ev) => { ev.stopPropagation(); editor.patch(e.id, { visible: !e.visible }); }}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                aria-label={e.visible ? `Hide ${elementLabel(e)}` : `Show ${elementLabel(e)}`}
              >
                {e.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              </button>
              <span className={cn("flex-1 text-sm font-medium", !e.visible && "text-muted-foreground line-through")}>
                {elementLabel(e)}
              </span>
              {e.kind === "text" && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(ev) => { ev.stopPropagation(); editor.removeEl(e.id); }}
                  className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                  aria-label={`Delete ${elementLabel(e)}`}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Inspector for the selected element */}
      {selected && <Inspector key={selected.id} el={selected} editor={editor} />}

      {/* Clock + Wi-Fi */}
      <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Clock timezone</Label>
          <Select value={layout.clockTimezone} onValueChange={(v) => onChange({ ...layout, clockTimezone: v })} disabled={disabled}>
            <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (<SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="clock-24h" className="text-xs text-muted-foreground">24-hour clock</Label>
          <Switch id="clock-24h" checked={layout.clock24h} onCheckedChange={(v) => onChange({ ...layout, clock24h: v })} disabled={disabled} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Wifi className="size-3.5" /> Wi-Fi signal</Label>
          <div className="flex gap-1.5">
            {[0, 1, 2, 3, 4].map((lvl) => (
              <button
                key={lvl}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...layout, wifiLevel: lvl })}
                className={cn(
                  "h-8 flex-1 rounded-md border text-xs font-medium transition-colors disabled:opacity-50",
                  layout.wifiLevel === lvl ? "border-foreground bg-foreground text-background" : "hover:bg-accent",
                )}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={editor.resetLayout}
        className="flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <RotateCcw className="size-4" /> Reset layout to default
      </button>
    </div>
  );
}

/** Inspector: pixel X/Y/W/H number boxes + per-kind controls for one element. */
function Inspector({ el, editor }: { el: KioskElement; editor: KioskEditor }) {
  const { canvasRef, elRefs, disabled } = editor;
  const onPatch = (p: Partial<KioskElement>) => editor.patch(el.id, p);

  // Natural pixel size on the 720 reference (visual size ÷ current sx/sy).
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const node = elRefs.current?.get(el.id);
    if (!canvas || !node) return;
    const cw = canvas.getBoundingClientRect().width || 1;
    const r = node.getBoundingClientRect();
    const k = CANVAS_REF_PX / cw;
    setNatural({ w: (r.width * k) / el.sx, h: (r.height * k) / el.sy });
  }, [el.id, el.sx, el.sy, el.text, canvasRef, elRefs]);

  const wPx = natural ? Math.round(natural.w * el.sx) : null;
  const hPx = natural ? Math.round(natural.h * el.sy) : null;

  const setWidthPx = (v: number) => { if (natural && natural.w > 0) onPatch({ sx: clamp(v / natural.w, SCALE_MIN, SCALE_MAX) }); };
  const setHeightPx = (v: number) => { if (natural && natural.h > 0) onPatch({ sy: clamp(v / natural.h, SCALE_MIN, SCALE_MAX) }); };

  return (
    <div className="space-y-3 rounded-xl border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{elementLabel(el)}</span>
        <button type="button" disabled={disabled} onClick={() => editor.bringToFront(el.id)} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
          Bring to front
        </button>
      </div>

      {el.kind === "text" && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Text</Label>
          <Input value={el.text ?? ""} disabled={disabled} maxLength={MAX_TEXT_LEN} onChange={(e) => onPatch({ text: e.target.value })} className="h-8" />
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        <NumberField label="X" value={Math.round(el.x * CANVAS_REF_PX)} disabled={disabled} onChange={(v) => onPatch({ x: clamp(v / CANVAS_REF_PX, 0, 1) })} />
        <NumberField label="Y" value={Math.round(el.y * CANVAS_REF_PX)} disabled={disabled} onChange={(v) => onPatch({ y: clamp(v / CANVAS_REF_PX, 0, 1) })} />
        <NumberField label="W" value={wPx} disabled={disabled || !natural} onChange={setWidthPx} />
        <NumberField label="H" value={hPx} disabled={disabled || !natural} onChange={setHeightPx} />
      </div>
      <p className="text-[10px] text-muted-foreground">Pixels on the 720 × 720 kiosk canvas.</p>
    </div>
  );
}

/** Small labelled numeric input (px). Buffers keystrokes locally and commits on
 *  blur/Enter so multi-digit typing isn't fought by parent re-renders; while not
 *  focused it tracks the live `value` (e.g. during a drag). */
function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = React.useState<string>(value?.toString() ?? "");
  const [focused, setFocused] = React.useState(false);

  React.useEffect(() => {
    if (!focused) setDraft(value?.toString() ?? "");
  }, [value, focused]);

  const commit = () => {
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n)) onChange(n);
    else setDraft(value?.toString() ?? "");
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
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        className="h-8 px-2 font-mono text-xs tabular-nums"
      />
    </div>
  );
}

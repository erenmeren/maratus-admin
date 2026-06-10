"use client";

import * as React from "react";
import { Eye, EyeOff, Plus, RotateCcw, Trash2, Wifi } from "lucide-react";
import { KioskElementView, kioskRootStyle, type KioskBrand } from "./kiosk-preview";
import {
  DEFAULT_KIOSK_LAYOUT,
  createTextElement,
  elementLabel,
  MAX_CUSTOM,
  MAX_TEXT_LEN,
  SCALE_MIN,
  SCALE_MAX,
  type KioskElement,
  type KioskLayout,
} from "@/lib/kiosk-layout";
import { HANDLES, resizeBox, clampCenter, type Box, type Handle } from "@/lib/kiosk-geometry";
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
const SNAP = 0.025; // snap-to-center threshold (fraction)
const CANVAS_REF_PX = 720; // design reference for pixel readouts

type DragKind =
  | { type: "move" }
  | { type: "resize"; handle: Handle; startBox: Box; startEl: KioskElement };

export function KioskLayoutEditor({
  brand,
  layout,
  onChange,
  disabled,
}: {
  brand: KioskBrand;
  layout: KioskLayout;
  onChange: (l: KioskLayout) => void;
  disabled?: boolean;
}) {
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const elRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const drag = React.useRef<DragKind | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [guide, setGuide] = React.useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  // The selected element's VISUAL rect (in canvas fractions), measured from the
  // DOM so the handle overlay tracks the scaled size — transforms don't change
  // an element's layout box, so handles can't be children of the scaled node.
  const [selBox, setSelBox] = React.useState<Box | null>(null);

  const selected = layout.elements.find((e) => e.id === selectedId) ?? null;
  const customCount = layout.elements.filter((e) => e.kind === "text").length;
  const atCustomCap = customCount >= MAX_CUSTOM;

  function patch(id: string, p: Partial<KioskElement>) {
    onChange({ ...layout, elements: layout.elements.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  }

  function pointerFrac(e: React.PointerEvent): { x: number; y: number } {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  }

  /** Element visual rect in canvas fractions (includes the scale transform). */
  function elementBox(id: string): Box {
    const canvas = canvasRef.current!.getBoundingClientRect();
    const node = elRefs.current.get(id)!.getBoundingClientRect();
    return {
      cx: (node.left + node.width / 2 - canvas.left) / canvas.width,
      cy: (node.top + node.height / 2 - canvas.top) / canvas.height,
      w: node.width / canvas.width,
      h: node.height / canvas.height,
    };
  }

  function startMove(id: string, e: React.PointerEvent) {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(id);
    drag.current = { type: "move" };
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function startResize(handle: Handle, e: React.PointerEvent) {
    if (disabled || !selected) return;
    e.stopPropagation();
    e.preventDefault();
    drag.current = { type: "resize", handle, startBox: elementBox(selected.id), startEl: selected };
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !selected) return;
    const p = pointerFrac(e);
    if (d.type === "move") {
      let x = p.x;
      let y = p.y;
      const snapX = Math.abs(x - 0.5) < SNAP;
      const snapY = Math.abs(y - 0.5) < SNAP;
      if (snapX) x = 0.5;
      if (snapY) y = 0.5;
      setGuide({ x: snapX, y: snapY });
      const c = clampCenter({ cx: x, cy: y, w: 0, h: 0 });
      patch(selected.id, { x: c.cx, y: c.cy });
    } else {
      const isCorner = d.handle.length === 2;
      const nb = clampCenter(resizeBox(d.startBox, d.handle, p, isCorner));
      const sx = d.startBox.w > 0
        ? clamp(d.startEl.sx * (nb.w / d.startBox.w), SCALE_MIN, SCALE_MAX)
        : d.startEl.sx;
      const sy = d.startBox.h > 0
        ? clamp(d.startEl.sy * (nb.h / d.startBox.h), SCALE_MIN, SCALE_MAX)
        : d.startEl.sy;
      patch(selected.id, { x: nb.cx, y: nb.cy, sx, sy });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (drag.current && canvasRef.current?.hasPointerCapture(e.pointerId)) {
      canvasRef.current.releasePointerCapture(e.pointerId);
    }
    drag.current = null;
    setGuide({ x: false, y: false });
  }

  function addText() {
    if (disabled || atCustomCap) return;
    const maxZ = layout.elements.reduce((m, e) => Math.max(m, e.z), 0);
    const el = createTextElement("New text", maxZ + 1);
    onChange({ ...layout, elements: [...layout.elements, el] });
    setSelectedId(el.id);
  }

  function removeEl(id: string) {
    onChange({ ...layout, elements: layout.elements.filter((e) => e.id !== id) });
    if (selectedId === id) setSelectedId(null);
  }

  function bringToFront(id: string) {
    const maxZ = layout.elements.reduce((m, e) => Math.max(m, e.z), 0);
    patch(id, { z: maxZ + 1 });
  }

  // Keep the handle overlay synced to the selected element's measured visual box.
  // Re-measures whenever its geometry/text changes (incl. during a drag, since
  // patch() updates those). Boxes are fractions, so canvas resize needs no recompute.
  React.useLayoutEffect(() => {
    if (!selectedId || !selected?.visible || !elRefs.current.get(selectedId) || !canvasRef.current) {
      setSelBox(null);
      return;
    }
    setSelBox(elementBox(selectedId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.visible, selected?.x, selected?.y, selected?.sx, selected?.sy, selected?.text, brand.logoUrl]);

  const ordered = [...layout.elements].sort((a, b) => a.z - b.z);

  return (
    <div className="space-y-4">
      {/* ── Canvas ── */}
      <div
        ref={canvasRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerDown={() => setSelectedId(null)}
        className="@container relative aspect-square w-full touch-none overflow-hidden rounded-[4cqw] shadow-2xl ring-1 ring-black/10 select-none"
        style={{ ...kioskRootStyle(brand), background: "var(--k-bg)", color: "var(--k-fg)" }}
      >
        {guide.x && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2" style={{ background: "var(--k-accent)" }} />}
        {guide.y && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2" style={{ background: "var(--k-accent)" }} />}

        {ordered
          .filter((e) => e.visible)
          .map((e) => (
            <div
              key={e.id}
              ref={(n) => {
                if (n) elRefs.current.set(e.id, n);
                else elRefs.current.delete(e.id);
              }}
              onPointerDown={(ev) => startMove(e.id, ev)}
              className={cn("absolute", !disabled && "cursor-grab active:cursor-grabbing")}
              style={{ left: `${e.x * 100}%`, top: `${e.y * 100}%`, transform: "translate(-50%, -50%)", zIndex: e.z }}
            >
              <KioskElementView element={e} brand={brand} layout={layout} />
            </div>
          ))}

        {/* Selection overlay (separate layer so handles match the SCALED size). */}
        {selBox && selectedId && !disabled && (
          <SelectionOverlay box={selBox} onResizeStart={startResize} />
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Click to select · drag to move · drag a handle to resize (corners keep proportions, edges stretch)
      </p>

      {/* ── Add / element list ── */}
      <div className="space-y-2 rounded-xl border p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Elements</span>
          <button
            type="button"
            disabled={disabled || atCustomCap}
            onClick={addText}
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
                onClick={(ev) => { ev.stopPropagation(); patch(e.id, { visible: !e.visible }); }}
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
                  onClick={(ev) => { ev.stopPropagation(); removeEl(e.id); }}
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

      {/* ── Inspector for the selected element ── */}
      {selected && (
        <Inspector
          key={selected.id}
          el={selected}
          canvasRef={canvasRef}
          elRefs={elRefs}
          disabled={disabled}
          onPatch={(p) => patch(selected.id, p)}
          onBringToFront={() => bringToFront(selected.id)}
        />
      )}

      {/* ── Clock + Wi-Fi ── */}
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
        onClick={() => { onChange(DEFAULT_KIOSK_LAYOUT); setSelectedId(null); }}
        className="flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <RotateCcw className="size-4" /> Reset layout to default
      </button>
    </div>
  );
}

/**
 * Selection ring + 8 resize handles, drawn on its own layer at the element's
 * measured visual box (fractions). The layer is pointer-transparent except the
 * handle dots, so dragging the element body underneath still moves it.
 */
function SelectionOverlay({
  box,
  onResizeStart,
}: {
  box: Box;
  onResizeStart: (handle: Handle, e: React.PointerEvent) => void;
}) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${(box.cx - box.w / 2) * 100}%`,
        top: `${(box.cy - box.h / 2) * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
        zIndex: 9999,
      }}
    >
      <div className="absolute -inset-1 rounded-[1cqw] ring-2" style={{ "--tw-ring-color": "var(--k-accent)" } as React.CSSProperties} />
      {HANDLES.map((h) => (
        <ResizeHandleDot key={h} handle={h} onDown={(e) => onResizeStart(h, e)} />
      ))}
    </div>
  );
}

/** A single resize handle dot, positioned on the overlay edge by compass name. */
function ResizeHandleDot({ handle, onDown }: { handle: Handle; onDown: (e: React.PointerEvent) => void }) {
  const pos: Record<Handle, string> = {
    nw: "left-0 top-0", n: "left-1/2 top-0", ne: "right-0 top-0",
    e: "right-0 top-1/2", se: "right-0 bottom-0", s: "left-1/2 bottom-0",
    sw: "left-0 bottom-0", w: "left-0 top-1/2",
  };
  const cursor: Record<Handle, string> = {
    nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
    n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  };
  return (
    <div
      onPointerDown={onDown}
      className={cn("pointer-events-auto absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow", pos[handle])}
      style={{ cursor: cursor[handle], background: "var(--k-accent)" }}
      aria-label={`Resize ${handle}`}
    />
  );
}

/** Inspector: pixel X/Y/W/H number boxes + per-kind controls for one element. */
function Inspector({
  el,
  canvasRef,
  elRefs,
  disabled,
  onPatch,
  onBringToFront,
}: {
  el: KioskElement;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  elRefs: React.RefObject<Map<string, HTMLDivElement>>;
  disabled?: boolean;
  onPatch: (p: Partial<KioskElement>) => void;
  onBringToFront: () => void;
}) {
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
        <button type="button" disabled={disabled} onClick={onBringToFront} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
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

  // Track external updates only while the user isn't actively editing.
  React.useEffect(() => {
    if (!focused) setDraft(value?.toString() ?? "");
  }, [value, focused]);

  const commit = () => {
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n)) onChange(n);
    else setDraft(value?.toString() ?? ""); // revert empty/invalid
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

"use client";

import * as React from "react";
import { Eye, EyeOff, RotateCcw, Wifi } from "lucide-react";
import {
  KioskElementView,
  kioskRootStyle,
  type KioskBrand,
} from "./kiosk-preview";
import {
  DEFAULT_KIOSK_LAYOUT,
  KIOSK_ELEMENT_IDS,
  KIOSK_ELEMENT_LABEL,
  SCALE_MIN,
  SCALE_MAX,
  type KioskElementId,
  type KioskLayout,
} from "@/lib/kiosk-layout";
import { Label } from "@/components/ui/label";
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

/**
 * Drag-and-drop kiosk idle-screen studio. Elements are positioned by dragging on
 * a live canvas; a controls rail toggles visibility, scales each element, and
 * sets the clock timezone / Wi-Fi level. Layout is fully controlled by the parent.
 */
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
  const dragId = React.useRef<KioskElementId | null>(null);
  const [selected, setSelected] = React.useState<KioskElementId | null>(null);
  const [guide, setGuide] = React.useState<{ x: boolean; y: boolean }>({ x: false, y: false });

  function patchElement(id: KioskElementId, patch: Partial<KioskLayout["elements"][number]>) {
    onChange({
      ...layout,
      elements: layout.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }

  function onPointerDown(id: KioskElementId, e: React.PointerEvent) {
    if (disabled) return;
    e.preventDefault();
    setSelected(id);
    dragId.current = id;
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const id = dragId.current;
    const canvas = canvasRef.current;
    if (!id || !canvas) return;
    const r = canvas.getBoundingClientRect();
    let x = clamp((e.clientX - r.left) / r.width, 0, 1);
    let y = clamp((e.clientY - r.top) / r.height, 0, 1);
    const snapX = Math.abs(x - 0.5) < SNAP;
    const snapY = Math.abs(y - 0.5) < SNAP;
    if (snapX) x = 0.5;
    if (snapY) y = 0.5;
    setGuide({ x: snapX, y: snapY });
    patchElement(id, { x, y });
  }

  function onPointerUp(e: React.PointerEvent) {
    if (dragId.current) canvasRef.current?.releasePointerCapture(e.pointerId);
    dragId.current = null;
    setGuide({ x: false, y: false });
  }

  const el = (id: KioskElementId) => layout.elements.find((e) => e.id === id)!;

  return (
    <div className="space-y-4">
      {/* ── Canvas ── */}
      <div
        ref={canvasRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className="@container relative aspect-square w-full touch-none overflow-hidden rounded-[4cqw] shadow-2xl ring-1 ring-black/10 select-none"
        style={{ ...kioskRootStyle(brand), background: "var(--k-bg)", color: "var(--k-fg)" }}
        onPointerDown={() => setSelected(null)}
      >
        {/* center snap guides */}
        {guide.x && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2" style={{ background: "var(--k-accent)" }} />}
        {guide.y && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2" style={{ background: "var(--k-accent)" }} />}

        {layout.elements
          .filter((e) => e.visible)
          .map((e) => (
            <div
              key={e.id}
              onPointerDown={(ev) => {
                ev.stopPropagation();
                onPointerDown(e.id, ev);
              }}
              className={cn(
                "absolute flex justify-center rounded-[2cqw] transition-shadow",
                !disabled && "cursor-grab active:cursor-grabbing",
                selected === e.id && "ring-2 ring-offset-2",
              )}
              style={{
                left: `${e.x * 100}%`,
                top: `${e.y * 100}%`,
                transform: "translate(-50%, -50%)",
                maxWidth: "92%",
                padding: "1.5cqw",
                ...(selected === e.id
                  ? ({ "--tw-ring-color": "var(--k-accent)", "--tw-ring-offset-color": "var(--k-bg)" } as React.CSSProperties)
                  : {}),
              }}
            >
              <KioskElementView id={e.id} brand={brand} layout={layout} scale={e.scale} />
            </div>
          ))}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Drag elements to reposition. Snap to the center lines. Toggle and resize below.
      </p>

      {/* ── Element controls ── */}
      <div className="space-y-2 rounded-xl border p-3">
        {KIOSK_ELEMENT_IDS.map((id) => {
          const e = el(id);
          const active = selected === id;
          return (
            <div
              key={id}
              onClick={() => e.visible && setSelected(id)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors",
                active && "bg-accent",
                e.visible && "cursor-pointer",
              )}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={(ev) => {
                  ev.stopPropagation();
                  patchElement(id, { visible: !e.visible });
                }}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                aria-label={e.visible ? `Hide ${KIOSK_ELEMENT_LABEL[id]}` : `Show ${KIOSK_ELEMENT_LABEL[id]}`}
              >
                {e.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              </button>
              <span className={cn("w-28 shrink-0 text-sm font-medium", !e.visible && "text-muted-foreground line-through")}>
                {KIOSK_ELEMENT_LABEL[id]}
              </span>
              <input
                type="range"
                min={SCALE_MIN}
                max={SCALE_MAX}
                step={0.05}
                value={e.scale}
                disabled={disabled || !e.visible}
                onChange={(ev) => patchElement(id, { scale: Number(ev.target.value) })}
                className="h-1 flex-1 cursor-pointer accent-foreground disabled:opacity-40"
                aria-label={`${KIOSK_ELEMENT_LABEL[id]} size`}
              />
              <span className="w-10 text-right font-mono text-xs text-muted-foreground tabular-nums">
                {Math.round(e.scale * 100)}%
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Clock + Wi-Fi ── */}
      <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Clock timezone</Label>
          <Select
            value={layout.clockTimezone}
            onValueChange={(v) => onChange({ ...layout, clockTimezone: v })}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="clock-24h" className="text-xs text-muted-foreground">
            24-hour clock
          </Label>
          <Switch
            id="clock-24h"
            checked={layout.clock24h}
            onCheckedChange={(v) => onChange({ ...layout, clock24h: v })}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Wifi className="size-3.5" /> Wi-Fi signal
          </Label>
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
        onClick={() => onChange(DEFAULT_KIOSK_LAYOUT)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <RotateCcw className="size-4" /> Reset layout to default
      </button>
    </div>
  );
}

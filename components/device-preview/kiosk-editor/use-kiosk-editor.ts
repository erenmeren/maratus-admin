"use client";

import * as React from "react";
import {
  createTextObject,
  defaultLayout,
  MAX_CUSTOM,
  type KioskObject,
  type KioskLayout,
} from "@/lib/kiosk-layout";
import { resizeBox, snapMove, snapResize, clampToCanvas, type Box, type Handle, type Guides } from "@/lib/kiosk-geometry";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const SNAP = 0.012; // snap threshold (fraction)
const EMPTY_GUIDES: Guides = { vx: [], hy: [] };

const toBox = (o: KioskObject): Box => ({ x: o.x, y: o.y, w: o.w, h: o.h });

type DragKind =
  | { type: "move"; offset: { x: number; y: number } }
  | { type: "resize"; handle: Handle; startBox: Box };

/** Everything the kiosk canvas (KioskStage) and controls (KioskControls) share. */
export interface KioskEditor {
  layout: KioskLayout;
  onChange: (l: KioskLayout) => void;
  disabled: boolean;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  selectedId: string | null;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  selected: KioskObject | null;
  selBox: Box | null;
  guides: Guides;
  ordered: KioskObject[];
  atCustomCap: boolean;
  patch: (id: string, p: Partial<KioskObject>) => void;
  startMove: (id: string, e: React.PointerEvent) => void;
  startResize: (handle: Handle, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onCanvasPointerDown: () => void;
  addText: () => void;
  removeObject: (id: string) => void;
  bringToFront: (id: string) => void;
  resetLayout: () => void;
  endInteraction: () => void;
}

export function useKioskEditor({
  layout,
  onChange,
  disabled = false,
}: {
  layout: KioskLayout;
  onChange: (l: KioskLayout) => void;
  disabled?: boolean;
}): KioskEditor {
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<DragKind | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [guides, setGuides] = React.useState<Guides>(EMPTY_GUIDES);

  const selected = layout.objects.find((o) => o.id === selectedId) ?? null;
  const selBox = selected && selected.visible ? toBox(selected) : null;
  const customCount = layout.objects.filter((o) => o.type === "text").length;
  const atCustomCap = customCount >= MAX_CUSTOM;

  function patch(id: string, p: Partial<KioskObject>) {
    onChange({ ...layout, objects: layout.objects.map((o) => (o.id === id ? { ...o, ...p } : o)) });
  }

  function pointerFrac(e: React.PointerEvent): { x: number; y: number } {
    const r = canvasRef.current!.getBoundingClientRect();
    const w = r.width || 1; // guard against a zero-sized canvas producing NaN
    const h = r.height || 1;
    return { x: clamp((e.clientX - r.left) / w, 0, 1), y: clamp((e.clientY - r.top) / h, 0, 1) };
  }

  function others(excludeId: string): Box[] {
    return layout.objects.filter((o) => o.id !== excludeId && o.visible).map(toBox);
  }

  function startMove(id: string, e: React.PointerEvent) {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(id);
    const obj = layout.objects.find((o) => o.id === id);
    const p = pointerFrac(e);
    drag.current = { type: "move", offset: obj ? { x: p.x - obj.x, y: p.y - obj.y } : { x: 0, y: 0 } };
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function startResize(handle: Handle, e: React.PointerEvent) {
    if (disabled || !selected) return;
    e.stopPropagation();
    e.preventDefault();
    drag.current = { type: "resize", handle, startBox: toBox(selected) };
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !selected) return;
    const p = pointerFrac(e);
    if (d.type === "move") {
      const moved: Box = { x: p.x - d.offset.x, y: p.y - d.offset.y, w: selected.w, h: selected.h };
      const snapped = snapMove(moved, others(selected.id), SNAP);
      const box = clampToCanvas(snapped.box);
      setGuides(snapped.guides);
      patch(selected.id, { x: box.x, y: box.y });
    } else {
      const raw = resizeBox(d.startBox, d.handle, p);
      const snapped = snapResize(raw, d.handle, others(selected.id), SNAP);
      const box = clampToCanvas(snapped.box);
      setGuides(snapped.guides);
      patch(selected.id, { x: box.x, y: box.y, w: box.w, h: box.h });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (drag.current && canvasRef.current?.hasPointerCapture(e.pointerId)) {
      canvasRef.current.releasePointerCapture(e.pointerId);
    }
    drag.current = null;
    setGuides(EMPTY_GUIDES);
  }

  function onCanvasPointerDown() {
    setSelectedId(null);
  }

  function addText() {
    if (disabled || atCustomCap) return;
    const maxZ = layout.objects.reduce((m, o) => Math.max(m, o.z), 0);
    const o = createTextObject("New text", maxZ + 1);
    onChange({ ...layout, objects: [...layout.objects, o] });
    setSelectedId(o.id);
  }

  function removeObject(id: string) {
    onChange({ ...layout, objects: layout.objects.filter((o) => o.id !== id) });
    if (selectedId === id) setSelectedId(null);
  }

  function bringToFront(id: string) {
    const maxZ = layout.objects.reduce((m, o) => Math.max(m, o.z), 0);
    patch(id, { z: maxZ + 1 });
  }

  function resetLayout() {
    onChange(defaultLayout());
    setSelectedId(null);
  }

  /** Clear transient interaction state when the canvas unmounts. */
  function endInteraction() {
    drag.current = null;
    setGuides(EMPTY_GUIDES);
    setSelectedId(null);
  }

  const ordered = [...layout.objects].sort((a, b) => a.z - b.z);

  return {
    layout,
    onChange,
    disabled,
    canvasRef,
    selectedId,
    setSelectedId,
    selected,
    selBox,
    guides,
    ordered,
    atCustomCap,
    patch,
    startMove,
    startResize,
    onPointerMove,
    onPointerUp,
    onCanvasPointerDown,
    addText,
    removeObject,
    bringToFront,
    resetLayout,
    endInteraction,
  };
}

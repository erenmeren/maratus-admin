"use client";

import * as React from "react";
import {
  DEFAULT_KIOSK_LAYOUT,
  createTextElement,
  MAX_CUSTOM,
  SCALE_MIN,
  SCALE_MAX,
  type KioskElement,
  type KioskLayout,
} from "@/lib/kiosk-layout";
import { resizeBox, clampCenter, type Box, type Handle } from "@/lib/kiosk-geometry";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const SNAP = 0.025; // snap-to-center threshold (fraction)

type DragKind =
  | { type: "move" }
  | { type: "resize"; handle: Handle; startBox: Box; startEl: KioskElement };

/** Everything the kiosk canvas (KioskStage) and controls (KioskControls) share. */
export interface KioskEditor {
  layout: KioskLayout;
  onChange: (l: KioskLayout) => void;
  disabled: boolean;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  elRefs: React.RefObject<Map<string, HTMLDivElement>>;
  selectedId: string | null;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  selected: KioskElement | null;
  guide: { x: boolean; y: boolean };
  selBox: Box | null;
  ordered: KioskElement[];
  atCustomCap: boolean;
  patch: (id: string, p: Partial<KioskElement>) => void;
  startMove: (id: string, e: React.PointerEvent) => void;
  startResize: (handle: Handle, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onCanvasPointerDown: () => void;
  addText: () => void;
  removeEl: (id: string) => void;
  bringToFront: (id: string) => void;
  resetLayout: () => void;
  endInteraction: () => void;
}

/**
 * Owns kiosk idle-layout editing state/handlers so the canvas and the controls
 * can render in separate panes off one instance. `remeasureKey` re-measures the
 * selection overlay when an external visual changes natural size (e.g. the logo).
 */
export function useKioskEditor({
  layout,
  onChange,
  disabled = false,
  remeasureKey,
}: {
  layout: KioskLayout;
  onChange: (l: KioskLayout) => void;
  disabled?: boolean;
  remeasureKey?: unknown;
}): KioskEditor {
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const elRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const drag = React.useRef<DragKind | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [guide, setGuide] = React.useState<{ x: boolean; y: boolean }>({ x: false, y: false });
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

  function onCanvasPointerDown() {
    setSelectedId(null);
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

  function resetLayout() {
    onChange(DEFAULT_KIOSK_LAYOUT);
    setSelectedId(null);
  }

  /** Clear all transient interaction state (drag, selection, guides). Called when
   *  the canvas unmounts so stale state can't bleed across screen switches. */
  function endInteraction() {
    drag.current = null;
    setGuide({ x: false, y: false });
    setSelectedId(null);
    setSelBox(null);
  }

  // Keep the handle overlay synced to the selected element's measured visual box.
  React.useLayoutEffect(() => {
    if (!selectedId || !selected?.visible || !elRefs.current.get(selectedId) || !canvasRef.current) {
      setSelBox(null);
      return;
    }
    setSelBox(elementBox(selectedId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.visible, selected?.x, selected?.y, selected?.sx, selected?.sy, selected?.text, remeasureKey]);

  const ordered = [...layout.elements].sort((a, b) => a.z - b.z);

  return {
    layout,
    onChange,
    disabled,
    canvasRef,
    elRefs,
    selectedId,
    setSelectedId,
    selected,
    guide,
    selBox,
    ordered,
    atCustomCap,
    patch,
    startMove,
    startResize,
    onPointerMove,
    onPointerUp,
    onCanvasPointerDown,
    addText,
    removeEl,
    bringToFront,
    resetLayout,
    endInteraction,
  };
}

"use client";

import * as React from "react";
import { KioskElementView, kioskRootStyle, type KioskBrand } from "../kiosk-preview";
import { HANDLES, type Box, type Handle } from "@/lib/kiosk-geometry";
import type { KioskEditor } from "./use-kiosk-editor";
import { cn } from "@/lib/utils";

/** The editable kiosk canvas: positioned elements, snap guides, and the
 *  selection/resize overlay. Driven entirely by a useKioskEditor instance. */
export function KioskStage({ editor, brand }: { editor: KioskEditor; brand: KioskBrand }) {
  const { layout, disabled, canvasRef, elRefs, ordered, guide, selBox, selectedId } = editor;
  return (
    <div
      ref={canvasRef}
      onPointerMove={editor.onPointerMove}
      onPointerUp={editor.onPointerUp}
      onPointerLeave={editor.onPointerUp}
      onPointerDown={editor.onCanvasPointerDown}
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
            onPointerDown={(ev) => editor.startMove(e.id, ev)}
            className={cn("absolute", !disabled && "cursor-grab active:cursor-grabbing")}
            style={{ left: `${e.x * 100}%`, top: `${e.y * 100}%`, transform: "translate(-50%, -50%)", zIndex: e.z }}
          >
            <KioskElementView element={e} brand={brand} layout={layout} />
          </div>
        ))}

      {selBox && selectedId && !disabled && (
        <SelectionOverlay box={selBox} onResizeStart={editor.startResize} />
      )}
    </div>
  );
}

/**
 * Selection ring + 8 resize handles, on its own layer at the element's measured
 * visual box. Pointer-transparent except the handle dots, so dragging the body
 * underneath still moves it.
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

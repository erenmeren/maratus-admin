"use client";

import * as React from "react";
import { ObjectVisual, kioskRootStyle, type KioskBrand } from "../kiosk-preview";
import { HANDLES, type Box, type Handle } from "@/lib/kiosk-geometry";
import type { KioskEditor } from "./use-kiosk-editor";
import { cn } from "@/lib/utils";

/** The editable kiosk canvas: object boxes, alignment guides, and the
 *  selection/resize overlay. Driven entirely by a useKioskEditor instance. */
export function KioskStage({ editor, brand }: { editor: KioskEditor; brand: KioskBrand }) {
  const { layout, disabled, canvasRef, ordered, guides, selBox, selectedId } = editor;

  // Clear drag/selection when the canvas unmounts (e.g. switching preview screens).
  const endInteraction = editor.endInteraction;
  React.useEffect(() => {
    return () => endInteraction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {ordered
        .filter((o) => o.visible)
        .map((o) => (
          <div
            key={o.id}
            onPointerDown={(ev) => editor.startMove(o.id, ev)}
            className={cn("absolute", !disabled && "cursor-grab active:cursor-grabbing")}
            style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%`, zIndex: o.z }}
          >
            <ObjectVisual object={o} brand={brand} layout={layout} />
          </div>
        ))}

      {/* alignment guides */}
      {guides.vx.map((x, i) => (
        <div key={`v${i}`} className="pointer-events-none absolute inset-y-0 w-px" style={{ left: `${x * 100}%`, background: "var(--k-accent)" }} />
      ))}
      {guides.hy.map((y, i) => (
        <div key={`h${i}`} className="pointer-events-none absolute inset-x-0 h-px" style={{ top: `${y * 100}%`, background: "var(--k-accent)" }} />
      ))}

      {/* selection overlay */}
      {selBox && selectedId && !disabled && (
        <SelectionOverlay box={selBox} onResizeStart={editor.startResize} />
      )}
    </div>
  );
}

/** Selection ring + 8 resize handles on the selected object's box. */
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
      style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, zIndex: 9999 }}
    >
      <div className="absolute -inset-px rounded-[1cqw] ring-2" style={{ "--tw-ring-color": "var(--k-accent)" } as React.CSSProperties} />
      {HANDLES.map((h) => (
        <ResizeHandleDot key={h} handle={h} onDown={(e) => onResizeStart(h, e)} />
      ))}
    </div>
  );
}

const HANDLE_POS: Record<Handle, string> = {
  nw: "left-0 top-0", n: "left-1/2 top-0", ne: "right-0 top-0",
  e: "right-0 top-1/2", se: "right-0 bottom-0", s: "left-1/2 bottom-0",
  sw: "left-0 bottom-0", w: "left-0 top-1/2",
};
const HANDLE_CURSOR: Record<Handle, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
};

/** A single resize handle dot, positioned on the box edge by compass name. */
function ResizeHandleDot({ handle, onDown }: { handle: Handle; onDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onDown}
      className={cn("pointer-events-auto absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow", HANDLE_POS[handle])}
      style={{ cursor: HANDLE_CURSOR[handle], background: "var(--k-accent)" }}
      aria-label={`Resize ${handle}`}
    />
  );
}

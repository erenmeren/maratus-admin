"use client";

import * as React from "react";
import { ObjectVisual, printerRootStyle, cq, type PrinterBrand } from "../printer-preview";
import { MAX_TEXT_LEN } from "@/lib/printer-layout";
import { HANDLES, type Box, type Handle } from "@/lib/printer-geometry";
import type { PrinterEditor } from "./use-printer-editor";
import { cn } from "@/lib/utils";

/** The editable printer canvas: object boxes, alignment guides, and the
 *  selection/resize overlay. Driven entirely by a usePrinterEditor instance. */
export function PrinterStage({ editor, brand }: { editor: PrinterEditor; brand: PrinterBrand }) {
  const { config, disabled, canvasRef, ordered, guides, selBox, selectedId } = editor;

  // Clear drag/selection when the canvas unmounts (e.g. switching preview screens).
  const endInteraction = editor.endInteraction;
  React.useEffect(() => {
    return () => endInteraction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [editingId, setEditingId] = React.useState<string | null>(null);

  // Stop editing whenever the canvas unmounts (screen switch) or edit target hides.
  React.useEffect(() => {
    if (editingId && !ordered.some((o) => o.id === editingId && o.visible)) {
      setEditingId(null);
    }
  }, [editingId, ordered]);

  return (
    <div
      ref={canvasRef}
      onPointerMove={editor.onPointerMove}
      onPointerUp={editor.onPointerUp}
      onPointerLeave={editor.onPointerUp}
      onPointerDown={editor.onCanvasPointerDown}
      className="@container relative aspect-square w-full touch-none overflow-hidden shadow-2xl ring-1 ring-black/10 select-none"
      style={{ ...printerRootStyle(brand), background: "var(--k-bg)", color: "var(--k-fg)" }}
    >
      {ordered
        .filter((o) => o.visible)
        .map((o) => {
          const editing = editingId === o.id && o.type === "text";
          return (
            <div
              key={o.id}
              onPointerDown={(ev) => {
                if (editing) return; // let the textarea own the pointer
                editor.startMove(o.id, ev);
              }}
              onDoubleClick={() => {
                if (!disabled && o.type === "text") setEditingId(o.id);
              }}
              className={cn("absolute", !disabled && "cursor-grab active:cursor-grabbing")}
              style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%`, zIndex: editing ? 9998 : o.z }}
            >
              {editing ? (
                <InlineTextEditor
                  object={o}
                  onCommit={(text) => {
                    editor.patch(o.id, { text });
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <ObjectVisual object={o} brand={brand} config={config} />
              )}
            </div>
          );
        })}

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
  nw: "left-0 top-0", n: "left-1/2 top-0", ne: "left-full top-0",
  e: "left-full top-1/2", se: "left-full top-full", s: "left-1/2 top-full",
  sw: "left-0 top-full", w: "left-0 top-1/2",
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

/** Inline editor shown over a text object on double-click. */
function InlineTextEditor({
  object,
  onCommit,
  onCancel,
}: {
  object: { text?: string; fontSize?: number; align?: "left" | "center" | "right" };
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [val, setVal] = React.useState(object.text ?? "");

  React.useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <textarea
      ref={ref}
      value={val}
      maxLength={MAX_TEXT_LEN}
      onChange={(e) => setVal(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => onCommit(val)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onCommit(val);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="size-full resize-none rounded-[1cqw] bg-[var(--k-bg)]/90 text-[var(--k-fg)] outline-none ring-2 ring-[var(--k-accent)]"
      style={{
        fontSize: cq(object.fontSize ?? 24),
        textAlign: object.align ?? "center",
        fontWeight: 600,
        lineHeight: 1.1,
        padding: 0,
      }}
    />
  );
}

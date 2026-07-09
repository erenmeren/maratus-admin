"use client";

import * as React from "react";
import { ChevronLeft, Eye, EyeOff, Plus, RotateCcw, Trash2 } from "lucide-react";
import { objectLabel, MAX_CUSTOM, type PrinterObject } from "@/lib/printer-layout";
import type { PrinterEditor } from "./use-printer-editor";
import { PropertyFields } from "./printer-properties";
import { cn } from "@/lib/utils";

/** PROTOTYPE: how the selected object's properties are displayed.
 *  - "panel"    — current behavior: a grey panel below the object list
 *  - "inline"   — expands accordion-style under the selected list row
 *  - "drill"    — the rail swaps to a dedicated properties view with a back button
 *  - "floating" — a card floats next to the object on the canvas (rendered by the stage)
 *  - "bar"      — a contextual bar docks to the bottom of the stage (rendered by the stage)
 */
export type PropsVariant = "panel" | "inline" | "drill" | "floating" | "bar";

/** Object list + a type-aware properties panel for the selected object.
 *  Styled narrow-first: it lives in the Branding studio's ~19rem control rail. */
export function PrinterControls({
  editor,
  onImageUpload,
  propsVariant = "panel",
}: {
  editor: PrinterEditor;
  onImageUpload: (objectId: string, file: File) => void;
  propsVariant?: PropsVariant;
}) {
  const { ordered, disabled, selectedId, setSelectedId, selected, atCustomCap } = editor;

  // Drill-in: the whole rail becomes the selected object's properties view.
  if (propsVariant === "drill" && selected) {
    return <DrillProperties key={selected.id} object={selected} editor={editor} onImageUpload={onImageUpload} />;
  }

  const addButtons: { label: string; onClick: () => void; capped: boolean; show: boolean }[] = [
    { label: "Text", onClick: editor.addText, capped: atCustomCap, show: true },
    { label: "Image", onClick: editor.addImage, capped: atCustomCap, show: true },
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
            <React.Fragment key={o.id}>
              <div
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
                {/* Brand name (logo) is hide-only: with no add button it couldn't be re-added. */}
                {(o.type === "text" || o.type === "icon" || o.type === "image") && (
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

              {/* Inline: properties expand right under the selected row. */}
              {propsVariant === "inline" && active && (
                <div className="border-t border-border/60 bg-muted/50 p-3">
                  <div className="mb-2.5 flex justify-end">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => editor.bringToFront(o.id)}
                      className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      Bring to front
                    </button>
                  </div>
                  <PropertyFields object={o} editor={editor} onImageUpload={onImageUpload} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Panel (current behavior): properties in a grey box below the list. */}
      {propsVariant === "panel" && selected && (
        <PanelProperties key={selected.id} object={selected} editor={editor} onImageUpload={onImageUpload} />
      )}

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

/** "panel" variant — the pre-prototype display, kept as the baseline. */
function PanelProperties({
  object,
  editor,
  onImageUpload,
}: {
  object: PrinterObject;
  editor: PrinterEditor;
  onImageUpload: (objectId: string, file: File) => void;
}) {
  const { disabled } = editor;
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
      <PropertyFields object={object} editor={editor} onImageUpload={onImageUpload} />
    </div>
  );
}

/** "drill" variant — a focused properties view that replaces the rail content;
 *  the back button returns to the object list. */
function DrillProperties({
  object,
  editor,
  onImageUpload,
}: {
  object: PrinterObject;
  editor: PrinterEditor;
  onImageUpload: (objectId: string, file: File) => void;
}) {
  const { disabled } = editor;
  const deletable = object.type === "text" || object.type === "icon" || object.type === "image";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => editor.setSelectedId(null)}
          aria-label="Back to objects"
          className="flex size-7 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{objectLabel(object)}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.patch(object.id, { visible: !object.visible })}
          aria-label={object.visible ? `Hide ${objectLabel(object)}` : `Show ${objectLabel(object)}`}
          className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {object.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </button>
        {deletable && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => editor.removeObject(object.id)}
            aria-label={`Delete ${objectLabel(object)}`}
            className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      <PropertyFields object={object} editor={editor} onImageUpload={onImageUpload} />

      <button
        type="button"
        disabled={disabled}
        onClick={() => editor.bringToFront(object.id)}
        className="flex h-8 w-full items-center justify-center rounded-md border text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        Bring to front
      </button>
    </div>
  );
}

"use client";

import * as React from "react";
import { Eye, EyeOff, Plus, RotateCcw, Trash2 } from "lucide-react";
import { objectLabel, MAX_CUSTOM } from "@/lib/printer-layout";
import type { PrinterEditor } from "./use-printer-editor";
import { PropertyFields } from "./printer-properties";
import { cn } from "@/lib/utils";

/** Object list with the selected object's properties expanding inline under
 *  its row. Styled narrow-first: it lives in the Branding studio's ~19rem
 *  control rail. */
export function PrinterControls({
  editor,
  onImageUpload,
}: {
  editor: PrinterEditor;
  onImageUpload: (objectId: string, file: File) => void;
}) {
  const { ordered, disabled, selectedId, setSelectedId, atCustomCap } = editor;

  const addButtons: { label: string; onClick: () => void; capped: boolean; cappedHint: string }[] = [
    { label: "Text", onClick: editor.addText, capped: atCustomCap, cappedHint: `Limit of ${MAX_CUSTOM} custom objects reached` },
    { label: "Image", onClick: editor.addImage, capped: atCustomCap, cappedHint: `Limit of ${MAX_CUSTOM} custom objects reached` },
    { label: "Clock", onClick: editor.addClock, capped: editor.hasClock, cappedHint: "This screen already has a clock" },
    { label: "Wi-Fi signal", onClick: editor.addWifi, capped: editor.hasWifi, cappedHint: "This screen already has a Wi-Fi signal" },
  ];

  // Clock + Wi-Fi can be re-added from the buttons above; the remaining widgets
  // (QR, spinner, countdown…) can't, so they stay hide-only.
  const deletable = (t: string) =>
    t === "text" || t === "image" || t === "clock" || t === "wifi";

  return (
    <div className="space-y-4">
      {/* Add objects */}
      <div className="grid grid-cols-2 gap-1.5">
        {addButtons.map((b) => (
          <button
            key={b.label}
            type="button"
            disabled={disabled || b.capped}
            onClick={b.onClick}
            title={b.capped ? b.cappedHint : undefined}
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
                // Toggle: clicking the selected row collapses its properties again.
                onClick={() => o.visible && setSelectedId(active ? null : o.id)}
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
                {deletable(o.type) && (
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

              {/* The selected object's properties expand right under its row. */}
              {active && (
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

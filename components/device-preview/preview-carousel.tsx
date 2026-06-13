"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { stepIndex, swipeStep } from "@/lib/branding-shell";
import { cn } from "@/lib/utils";

export function PreviewCarousel({
  count,
  index,
  onIndexChange,
  slideWidthPx,
  isDragging,
  renderSlide,
  ariaLabels,
}: {
  count: number;
  index: number;
  onIndexChange: (i: number) => void;
  slideWidthPx: number;
  isDragging?: () => boolean;
  renderSlide: (i: number) => React.ReactNode;
  ariaLabels?: string[];
}) {
  const frameRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ startX: number; active: boolean } | null>(null);
  const [dragDx, setDragDx] = React.useState(0);

  function onPointerDown(e: React.PointerEvent) {
    // Don't start a swipe if an object drag is underway, or on a secondary button.
    if (isDragging?.() || e.button !== 0) return;
    drag.current = { startX: e.clientX, active: true };
    setDragDx(0);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current?.active) return;
    if (isDragging?.()) {
      // An object grab started after our pointer-down — abandon the swipe.
      drag.current = null;
      setDragDx(0);
      return;
    }
    setDragDx(e.clientX - drag.current.startX);
  }
  function onPointerUp() {
    if (!drag.current?.active) return;
    const width = frameRef.current?.clientWidth ?? 0;
    const dir = swipeStep(dragDx, width);
    if (dir !== 0) onIndexChange(stepIndex(index, dir, count));
    drag.current = null;
    setDragDx(0);
  }

  const go = (dir: number) => onIndexChange(stepIndex(index, dir, count));

  return (
    <div className="space-y-3">
      <div className="relative">
        <div
          ref={frameRef}
          className="overflow-hidden touch-pan-y"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <div
            className={cn("flex", dragDx === 0 && "transition-transform duration-300 ease-out")}
            style={{ transform: `translateX(calc(${-index * 100}% + ${dragDx}px))` }}
          >
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="w-full shrink-0 px-1">
                {/* Square preview: cap width by the zoom px, the panel width (100%),
                    AND the viewport height (minus room for surrounding chrome) so the
                    square never overflows a short window — fits any screen. */}
                <div
                  className="mx-auto"
                  style={{ width: `min(${slideWidthPx}px, 100%, calc(100svh - 22rem))` }}
                >
                  {renderSlide(i)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <CarouselArrow side="left" onClick={() => go(-1)} />
        <CarouselArrow side="right" onClick={() => go(1)} />
      </div>

      <div className="flex items-center justify-center gap-1.5">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onIndexChange(i)}
            aria-label={ariaLabels?.[i] ?? `Go to screen ${i + 1}`}
            aria-current={i === index}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === index ? "w-5 bg-foreground" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function CarouselArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous screen" : "Next screen"}
      className={cn(
        "absolute top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border bg-background/80 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground",
        side === "left" ? "left-1" : "right-1",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

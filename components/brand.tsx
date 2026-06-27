import { cn } from "@/lib/utils";

/**
 * Ditto wordmark. The mark is a pair of overlapping document squares — a nod to
 * the "digital twin" of a paper document. Uses the app's emerald primary token.
 */
export function DittoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-full" fill="none">
        <rect x="3" y="3" width="13" height="13" rx="3.5" className="fill-primary/25" />
        <rect x="8" y="8" width="13" height="13" rx="3.5" className="fill-primary" />
        <path
          d="M11.5 14.5l2 2 4-4.5"
          stroke="var(--primary-foreground)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function DittoWordmark({
  className,
  subtle = false,
}: {
  className?: string;
  subtle?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <DittoMark />
      <span className="flex items-baseline gap-1">
        <span className="font-display text-lg font-bold tracking-tight">Ditto</span>
        {!subtle && (
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Admin
          </span>
        )}
      </span>
    </span>
  );
}

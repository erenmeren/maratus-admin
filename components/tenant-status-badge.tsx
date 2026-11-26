import { cn } from "@/lib/utils";
import { StatusGlyph } from "@/components/status-badge";
import type { TenantStatus } from "@/lib/types";

// Shape plus word: filled dot (active), triangle (suspended).
const META: Record<TenantStatus, { label: string; glyph: string }> = {
  active: { label: "Active", glyph: "text-status-online" },
  suspended: { label: "Suspended", glyph: "text-destructive" },
};

export function TenantStatusBadge({
  status,
  className,
}: {
  status: TenantStatus;
  className?: string;
}) {
  const m = META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[7px] text-[13px] font-normal whitespace-nowrap text-foreground",
        className,
      )}
    >
      <StatusGlyph kind={status} className={m.glyph} />
      {m.label}
    </span>
  );
}

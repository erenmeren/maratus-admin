import { cn } from "@/lib/utils";
import type { TenantStatus } from "@/lib/types";

const META: Record<TenantStatus, { label: string; cls: string; dot: string }> = {
  active: {
    label: "Active",
    cls: "bg-status-online/10 text-status-online",
    dot: "bg-status-online",
  },
  trial: {
    label: "Trial",
    cls: "bg-chart-3/10 text-chart-3",
    dot: "bg-chart-3",
  },
  suspended: {
    label: "Suspended",
    cls: "bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
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
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        m.cls,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

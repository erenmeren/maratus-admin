import { cn } from "@/lib/utils";
import type { InvoiceLifecycle, TenantStatus } from "@/lib/types";

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

const INVOICE_META = {
  paid: "bg-status-online/10 text-status-online",
  due: "bg-status-paused/15 text-status-paused",
  overdue: "bg-destructive/10 text-destructive",
} as const;

export function InvoiceStatusBadge({
  status,
  className,
}: {
  status: keyof typeof INVOICE_META;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        INVOICE_META[status],
        className,
      )}
    >
      {status}
    </span>
  );
}

const LIFECYCLE_META: Record<InvoiceLifecycle, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-status-paused/15 text-status-paused",
  paid: "bg-status-online/10 text-status-online",
};

export function InvoiceLifecycleBadge({
  status,
  className,
}: {
  status: InvoiceLifecycle;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        LIFECYCLE_META[status],
        className,
      )}
    >
      {status}
    </span>
  );
}

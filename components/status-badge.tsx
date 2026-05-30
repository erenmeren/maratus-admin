import { cn } from "@/lib/utils";
import type { DeviceStatus } from "@/lib/types";

const STATUS_META: Record<
  DeviceStatus,
  { label: string; dot: string; text: string; bg: string }
> = {
  online: {
    label: "Online",
    dot: "bg-status-online",
    text: "text-status-online",
    bg: "bg-status-online/10",
  },
  offline: {
    label: "Offline",
    dot: "bg-status-offline",
    text: "text-muted-foreground",
    bg: "bg-status-offline/10",
  },
  paused: {
    label: "Paused",
    dot: "bg-status-paused",
    text: "text-status-paused",
    bg: "bg-status-paused/10",
  },
};

export function StatusDot({
  status,
  pulse,
  className,
}: {
  status: DeviceStatus;
  pulse?: boolean;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span className={cn("relative inline-flex size-2.5", className)}>
      {pulse && status === "online" && (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-60",
            meta.dot,
          )}
        />
      )}
      <span className={cn("relative inline-flex size-2.5 rounded-full", meta.dot)} />
    </span>
  );
}

export function StatusBadge({
  status,
  className,
}: {
  status: DeviceStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        meta.bg,
        meta.text,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

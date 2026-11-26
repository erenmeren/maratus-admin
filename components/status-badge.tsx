import { cn } from "@/lib/utils";
import type { DeviceStatus } from "@/lib/types";

/**
 * Status is always shape plus word, never colour alone: filled dot (online),
 * hollow ring (offline), two bars (paused). The word stays in the text colour.
 */
const STATUS_META: Record<DeviceStatus, { label: string; dot: string; glyph: string }> = {
  online: { label: "Online", dot: "bg-status-online", glyph: "text-status-online" },
  offline: { label: "Offline", dot: "bg-status-offline", glyph: "text-status-offline" },
  paused: { label: "Paused", dot: "bg-status-paused", glyph: "text-status-paused" },
};

export type StatusGlyphKind = DeviceStatus | "active" | "suspended";

export function StatusGlyph({
  kind,
  className,
}: {
  kind: StatusGlyphKind;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden className={cn("size-2.5 shrink-0", className)}>
      {(kind === "online" || kind === "active") && (
        <circle cx="5" cy="5" r="4" fill="currentColor" />
      )}
      {kind === "offline" && (
        <circle cx="5" cy="5" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.8" />
      )}
      {kind === "paused" && (
        <>
          <rect x="1.6" y="1.2" width="2.4" height="7.6" rx=".9" fill="currentColor" />
          <rect x="6" y="1.2" width="2.4" height="7.6" rx=".9" fill="currentColor" />
        </>
      )}
      {kind === "suspended" && <path d="M5 .9 9.4 9H.6Z" fill="currentColor" />}
    </svg>
  );
}

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
        "inline-flex items-center gap-[7px] text-[13px] font-normal whitespace-nowrap text-foreground",
        className,
      )}
    >
      <StatusGlyph kind={status} className={meta.glyph} />
      {meta.label}
    </span>
  );
}

// lib/health.ts
// Pure operational-health thresholds + alert rules (no IO).

export const STALE_MINUTES = 15;
export const STUCK_PENDING_MINUTES = 30;
export const INACTIVE_DAYS = 7;

export type AlertSeverity = "info" | "warning";
export interface HealthAlert {
  key: string;
  severity: AlertSeverity;
  message: string;
}

/** A device that was active then went quiet (not paused, has been seen). */
export function isStale(
  lastSeenAt: Date | null,
  status: string,
  now: Date,
  thresholdMinutes = STALE_MINUTES,
): boolean {
  if (!lastSeenAt || status === "paused") return false;
  return now.getTime() - lastSeenAt.getTime() > thresholdMinutes * 60_000;
}

/** Derive the live alert list from summarized metrics. */
export function computeAlerts(input: {
  staleCount: number;
  stuckPendingCount: number;
  inactiveTenants: { id: string; name: string }[];
}): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  if (input.staleCount > 0)
    alerts.push({
      key: "devices-stale",
      severity: "warning",
      message: `${input.staleCount} device(s) not seen in ${STALE_MINUTES}+ minutes`,
    });
  if (input.stuckPendingCount > 0)
    alerts.push({
      key: "receipts-stuck",
      severity: "warning",
      message: `${input.stuckPendingCount} receipt(s) stuck pending ${STUCK_PENDING_MINUTES}+ minutes`,
    });
  for (const t of input.inactiveTenants)
    alerts.push({
      key: `tenant-inactive:${t.id}`,
      severity: "info",
      message: `${t.name}: no receipts in ${INACTIVE_DAYS} days`,
    });
  return alerts;
}

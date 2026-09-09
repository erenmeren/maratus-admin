// lib/health.ts
// Pure operational-health thresholds + alert rules (no IO).

export const STALE_MINUTES = 15;
export const INACTIVE_DAYS = 7;
/** Above this many inactive tenants, collapse into one summarized alert. */
export const INACTIVE_ALERT_CAP = 5;

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
      // Key kept as "documents-stuck": it is the persisted alert identity (alert
      // rows + dedupe); only the human-readable copy moved to trigger vocabulary.
      // The count is "undelivered triggers in the last 24h" — see
      // undeliveredTriggerWhere in lib/command-expiry.ts.
      key: "documents-stuck",
      severity: "warning",
      message: `${input.stuckPendingCount} trigger(s) undelivered in the last 24h`,
    });
  // Per-tenant alerts up to a cap; beyond that, one summarized alert so a
  // platform with many empty orgs doesn't produce an alert wall.
  if (input.inactiveTenants.length > INACTIVE_ALERT_CAP) {
    alerts.push({
      key: "tenants-inactive",
      severity: "info",
      message: `${input.inactiveTenants.length} tenants have no activations in ${INACTIVE_DAYS} days`,
    });
  } else {
    for (const t of input.inactiveTenants)
      alerts.push({
        key: `tenant-inactive:${t.id}`,
        severity: "info",
        message: `${t.name}: no activations in ${INACTIVE_DAYS} days`,
      });
  }
  return alerts;
}

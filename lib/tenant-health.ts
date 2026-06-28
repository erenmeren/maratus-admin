// lib/tenant-health.ts
// Pure per-tenant health rollup → traffic-light level. No IO. The IO that gathers
// the inputs lives in lib/data.ts (summarize / getCustomerDetail).
import { isSuspended } from "./billing/billing-status";
import { INACTIVE_DAYS } from "./health";

export type HealthLevel = "healthy" | "warning" | "critical";

export interface TenantHealthInput {
  deviceCount: number;
  onlineCount: number;
  offlineCount: number;
  subscriptionStatus: string | null;
  stuckPendingCount?: number;   // omitted on the cheap (list) path → treated as 0
  lastActivityAt?: Date | null;  // omitted on the list path → inactivity not escalated
}

export function tenantHealthLevel(input: TenantHealthInput, now: Date): HealthLevel {
  // critical: service blocked, or devices are unreachable with none online.
  // (An all-paused fleet is intentional, not critical — only offline counts.)
  if (isSuspended(input.subscriptionStatus)) return "critical";
  if (input.offlineCount > 0 && input.onlineCount === 0) return "critical";

  // warning: degraded but operational.
  if (input.offlineCount > 0) return "warning";
  if ((input.stuckPendingCount ?? 0) > 0) return "warning";
  if (input.subscriptionStatus === "past_due") return "warning";
  if (
    input.lastActivityAt != null &&
    now.getTime() - input.lastActivityAt.getTime() > INACTIVE_DAYS * 86_400_000
  ) {
    return "warning";
  }

  return "healthy";
}

import { formatNumber, formatUsdCents } from "@/lib/format";
import type { TenantBillingOverview } from "@/lib/data";

/**
 * Period-quota usage for a subscribed org: the open period's acked triggers
 * against the pooled monthly quota, and the overage that implies so far.
 * Read-only and shared by the tenant billing page and the super-admin
 * Subscription card so both render the same numbers from
 * getTenantBillingOverview — the math lives in lib/invoicing.ts.
 */
export function TriggerUsageSummary({
  usage,
}: {
  usage: Pick<
    TenantBillingOverview,
    | "used"
    | "includedTotal"
    | "overageTriggers"
    | "estimatedOverageUsdCents"
    | "overagePriceCents"
  >;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">This period</p>
        <p className="text-2xl font-semibold tabular-nums">
          {formatNumber(usage.used)}{" "}
          <span className="text-base font-normal text-muted-foreground">
            / {formatNumber(usage.includedTotal)} triggers
          </span>
        </p>
        <p className="text-sm text-muted-foreground">
          {usage.overageTriggers > 0
            ? `${formatNumber(usage.overageTriggers)} over the included quota.`
            : `${formatNumber(usage.includedTotal - usage.used)} included triggers left.`}
        </p>
      </div>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Overage so far</p>
        <p className="text-2xl font-semibold tabular-nums">
          {formatUsdCents(usage.estimatedOverageUsdCents)}
        </p>
        <p className="text-sm text-muted-foreground">
          {usage.overageTriggers > 0
            ? `${formatNumber(usage.overageTriggers)} extra × ${formatUsdCents(usage.overagePriceCents)}. Estimated; invoiced when the period closes.`
            : "Within the included quota."}
        </p>
      </div>
    </div>
  );
}

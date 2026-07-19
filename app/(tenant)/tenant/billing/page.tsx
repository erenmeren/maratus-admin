// app/(tenant)/tenant/billing/page.tsx
import { requireTenant } from "@/lib/session";
import { canManageTenant } from "@/lib/roles";
import {
  getCreditUsageByDevice,
  deviceNamesForOrg,
  currentMonthStart,
  getDeviceUsageThisMonth,
  getTenant,
} from "@/lib/data";
import { BuyCreditsSection } from "@/components/billing/buy-credits-form";
import { creditPacks } from "@/lib/billing/credit-packs";
import { getBalance } from "@/lib/credits";
import { PageHeader } from "@/components/page-header";
import { PageSection } from "@/components/page-section";
import { formatNumber } from "@/lib/format";

export default async function TenantBillingPage() {
  const { ctx, organizationId } = await requireTenant();
  const canManage = canManageTenant(
    ctx.organizations.find((o) => o.id === organizationId)?.role,
  );
  const [balance, usage, deviceNames, deviceUsage, tenant] = await Promise.all([
    getBalance(organizationId),
    getCreditUsageByDevice(organizationId, currentMonthStart()),
    deviceNamesForOrg(organizationId),
    getDeviceUsageThisMonth(organizationId),
    getTenant(organizationId),
  ]);
  const { billingPlan, includedTriggersPerDevice } = tenant;
  const packs = creditPacks();

  return (
    <>
      <PageHeader title="Billing" description="Manage your prepaid credit balance." />

      <BuyCreditsSection
        packs={packs}
        availableCredits={balance.available}
        canManage={canManage}
      />

      <PageSection title="Credit usage this month">
        <p className="text-sm text-muted-foreground">
          Available <span className="font-medium text-foreground tabular-nums">{balance.available}</span>
          {balance.held > 0 ? (
            <> · Held <span className="font-medium text-foreground tabular-nums">{balance.held}</span></>
          ) : null}
        </p>
        {usage.byDevice.length === 0 ? (
          <p className="text-sm text-muted-foreground">No credit usage this month.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Device</th>
                <th className="text-right">Credits</th>
                <th className="text-right">Triggers</th>
              </tr>
            </thead>
            <tbody>
              {usage.byDevice
                .slice()
                .sort((a, b) => b.credits - a.credits)
                .map((d) => (
                  <tr key={d.deviceId} className="border-t">
                    <td className="py-2">
                      {deviceNames.get(d.deviceId) ?? (d.deviceId === "unknown" ? "Unattributed" : d.deviceId)}
                    </td>
                    <td className="text-right tabular-nums">{d.credits}</td>
                    <td className="text-right tabular-nums">{d.count}</td>
                  </tr>
                ))}
              <tr className="border-t font-medium">
                <td className="py-2">Total</td>
                <td className="text-right tabular-nums">{usage.total}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        )}
      </PageSection>

      <PageSection
        title="Device usage this month"
        description={
          billingPlan === "flat"
            ? "Your plan includes unlimited triggers (fair use)."
            : billingPlan === "base_usage"
              ? `Each device includes ${formatNumber(includedTriggersPerDevice)} triggers per month; beyond that, triggers use credits.`
              : "Each trigger uses one credit."
        }
      >
        {deviceUsage.length === 0 ? (
          <p className="text-sm text-muted-foreground">No triggers yet this month.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Device</th>
                <th className="text-right">Triggers</th>
                {billingPlan === "base_usage" ? (
                  <th className="text-right">Included remaining</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {deviceUsage.map((u) => (
                <tr key={u.deviceId} className="border-t">
                  <td className="py-2">{u.name}</td>
                  <td className="text-right tabular-nums">{formatNumber(u.triggers)}</td>
                  {billingPlan === "base_usage" ? (
                    <td className="text-right tabular-nums">
                      {formatNumber(Math.max(0, includedTriggersPerDevice - u.triggers))}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PageSection>
    </>
  );
}

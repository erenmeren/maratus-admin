// app/(tenant)/tenant/billing/page.tsx
import { requireTenant } from "@/lib/session";
import { getCreditUsageByDevice, deviceNamesForOrg, currentMonthStart } from "@/lib/data";
import { BuyCreditsSection } from "@/components/billing/buy-credits-form";
import { creditPacks } from "@/lib/billing/credit-packs";
import { getBalance } from "@/lib/credits";
import { PageHeader } from "@/components/page-header";
import { PageSection } from "@/components/page-section";

export default async function TenantBillingPage() {
  const { organizationId } = await requireTenant();
  const [balance, usage, deviceNames] = await Promise.all([
    getBalance(organizationId),
    getCreditUsageByDevice(organizationId, currentMonthStart()),
    deviceNamesForOrg(organizationId),
  ]);
  const packs = creditPacks();

  return (
    <>
      <PageHeader title="Billing" description="Manage your prepaid credit balance." />

      <BuyCreditsSection packs={packs} availableCredits={balance.available} />

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
    </>
  );
}

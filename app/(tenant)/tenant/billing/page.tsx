// app/(tenant)/tenant/billing/page.tsx
import { requireTenant } from "@/lib/session";
import { getTenantBilling, getCreditUsageByDevice, deviceNamesForOrg, currentMonthStart } from "@/lib/data";
import { PaymentMethodForm } from "@/components/billing/payment-method-form";
import { BuyCreditsSection } from "@/components/billing/buy-credits-form";
import { creditPacks } from "@/lib/billing/credit-packs";
import { getBalance } from "@/lib/credits";

export default async function TenantBillingPage() {
  const { organizationId } = await requireTenant();
  const [billing, balance, usage, deviceNames] = await Promise.all([
    getTenantBilling(organizationId),
    getBalance(organizationId),
    getCreditUsageByDevice(organizationId, currentMonthStart()),
    deviceNamesForOrg(organizationId),
  ]);
  const packs = creditPacks();

  return (
    <div className="flex flex-col gap-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">
          {billing.hasSubscription
            ? `Subscription: ${billing.subscriptionStatus ?? "unknown"}`
            : "Activate billing to start your monthly plan."}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Payment method</h2>
        {billing.card ? (
          <p className="text-sm">
            {billing.card.brand} •••• {billing.card.last4}
          </p>
        ) : null}
        <PaymentMethodForm />
      </section>

      <BuyCreditsSection packs={packs} availableCredits={balance.available} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Credit usage this month</h2>
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
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Invoices</h2>
        {billing.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Period</th>
                <th>Documents</th>
                <th>Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {billing.invoices.map((inv) => (
                <tr key={inv.id} className="border-t">
                  <td className="py-2">{inv.periodStart.slice(0, 10)}</td>
                  <td>{inv.documentCount}</td>
                  <td>${inv.amount.toFixed(2)}</td>
                  <td>{inv.status}</td>
                  <td>
                    {inv.hostedInvoiceUrl ? (
                      <a className="underline" href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                        {inv.status === "sent" || inv.status === "overdue" ? "Pay" : "View"}
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

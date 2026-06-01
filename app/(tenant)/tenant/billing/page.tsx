// app/(tenant)/tenant/billing/page.tsx
import { requireTenant } from "@/lib/session";
import { getTenantBilling } from "@/lib/data";
import { PaymentMethodForm } from "@/components/billing/payment-method-form";

export default async function TenantBillingPage() {
  const { organizationId } = await requireTenant();
  const billing = await getTenantBilling(organizationId);

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

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Invoices</h2>
        {billing.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">Period</th>
                <th>Receipts</th>
                <th>Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {billing.invoices.map((inv) => (
                <tr key={inv.id} className="border-t">
                  <td className="py-2">{inv.periodStart.slice(0, 10)}</td>
                  <td>{inv.receiptCount}</td>
                  <td>${inv.amount.toFixed(2)}</td>
                  <td>{inv.status}</td>
                  <td>
                    {inv.hostedInvoiceUrl ? (
                      <a className="underline" href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                        View
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

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireTenant } from "@/lib/session";
import { isOrgPaymentBlocked } from "@/lib/billing/enforcement";

export default async function TenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ctx, organizationId } = await requireTenant();
  const activeName =
    ctx.organizations.find((o) => o.id === organizationId)?.name ?? "Workspace";

  // Billing enforcement. isOrgPaymentBlocked fails safe (no lock) on a read error.
  const payment = await isOrgPaymentBlocked(organizationId);
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (payment.blocked && pathname !== "/tenant/billing") {
    redirect("/tenant/billing");
  }
  // Show the past-due banner whenever there is an unpaid overdue invoice (the
  // grace window before the hard block above kicks in).
  const pastDue = payment.hasOverdueInvoice;

  return (
    <AppShell
      workspace="tenant"
      groupLabel="Workspace"
      topBarLabel={activeName}
      user={ctx.user}
      organizations={ctx.organizations}
      role={ctx.user.role}
      activeName={activeName}
      activeOrganizationId={organizationId}
    >
      {pastDue ? (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          Your account has an unpaid invoice. Pay it on the{" "}
          <a href="/tenant/billing" className="font-medium underline">
            Billing
          </a>{" "}
          page to avoid interruption.
        </div>
      ) : null}
      {children}
    </AppShell>
  );
}

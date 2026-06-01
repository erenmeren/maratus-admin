import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { requireTenant } from "@/lib/session";
import { db } from "@/lib/db";
import { tenantSettings } from "@/lib/db/schema";
import { isSuspended } from "@/lib/billing/billing-status";

export default async function TenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ctx, organizationId } = await requireTenant();
  const activeName =
    ctx.organizations.find((o) => o.id === organizationId)?.name ?? "Workspace";

  // Billing enforcement. Fail safe (no lock) on a transient read error.
  let subStatus: string | null = null;
  try {
    const [s] = await db
      .select({ status: tenantSettings.subscriptionStatus })
      .from(tenantSettings)
      .where(eq(tenantSettings.organizationId, organizationId))
      .limit(1);
    subStatus = s?.status ?? null;
  } catch (err) {
    console.error("[tenant layout] billing status read failed", err);
  }

  const pathname = (await headers()).get("x-pathname") ?? "";
  if (isSuspended(subStatus) && pathname !== "/tenant/billing") {
    redirect("/tenant/billing");
  }
  const pastDue = subStatus === "past_due";

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
          Your last payment failed. Update your payment method on the{" "}
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

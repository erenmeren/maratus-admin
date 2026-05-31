import { AppShell } from "@/components/app-shell";
import { requireTenant } from "@/lib/session";

export default async function TenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ctx, organizationId } = await requireTenant();
  const activeName =
    ctx.organizations.find((o) => o.id === organizationId)?.name ?? "Workspace";

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
      {children}
    </AppShell>
  );
}

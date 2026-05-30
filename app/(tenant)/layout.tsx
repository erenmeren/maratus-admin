import { AppShell } from "@/components/app-shell";
import { getDefaultTenant } from "@/lib/data";

export default function TenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenant = getDefaultTenant();
  return (
    <AppShell workspace="tenant" groupLabel="Workspace" topBarLabel={tenant.name}>
      {children}
    </AppShell>
  );
}

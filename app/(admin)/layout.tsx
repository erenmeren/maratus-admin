import { AppShell } from "@/components/app-shell";
import { requirePlatformAdmin } from "@/lib/session";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requirePlatformAdmin();
  return (
    <AppShell
      workspace="admin"
      groupLabel="Platform"
      topBarLabel="Super Admin · Maratus HQ"
      user={ctx.user}
      organizations={ctx.organizations}
      role={ctx.user.role}
      activeName="Maratus HQ"
      activeOrganizationId={ctx.activeOrganizationId}
    >
      {children}
    </AppShell>
  );
}

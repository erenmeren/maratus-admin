import { AppShell } from "@/components/app-shell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell
      workspace="admin"
      groupLabel="Platform"
      topBarLabel="Super Admin · Ditto HQ"
    >
      {children}
    </AppShell>
  );
}

import { Cpu } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { FleetTable } from "@/components/fleet-table";
import { getAllDevices, getTenants } from "@/lib/data";

export default async function FleetPage() {
  const rows = await getAllDevices();
  const customers = (await getTenants()).map((t) => ({ id: t.id, name: t.name }));
  const online = rows.filter((r) => r.status === "online").length;
  const paused = rows.filter((r) => r.status === "paused").length;
  const offline = rows.filter((r) => r.status === "offline").length;

  return (
    <>
      <PageHeader
        title="Device Fleet"
        description="Every printer across every customer, in one place."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total devices" value={String(rows.length)} icon={Cpu} />
        <KpiCard label="Online" value={String(online)} hint="accepting documents" />
        <KpiCard label="Paused" value={String(paused)} hint="temporarily off" />
        <KpiCard label="Offline" value={String(offline)} hint="unreachable" />
      </div>

      <FleetTable rows={rows} customers={customers} />
    </>
  );
}

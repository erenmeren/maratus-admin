import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { ListControls } from "@/components/list-controls";
import { PaginationBar } from "@/components/pagination-bar";
import { DeviceListActions } from "@/components/device-list-actions";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getTenantDevicesPage } from "@/lib/data";
import { parseListParams } from "@/lib/list-params";
import { requireTenant } from "@/lib/session";
import { formatNumber, timeAgo } from "@/lib/format";

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { ctx, organizationId } = await requireTenant();
  const { q, status, page } = parseListParams(await searchParams);
  const { rows, total, counts } = await getTenantDevicesPage(organizationId, { q, status, page });
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  const canManage = !!membership && ["owner", "admin"].includes(membership.role);

  const tabs = [
    { value: "all", label: "All", count: counts.all, active: status === "all" },
    { value: "online", label: "Online", count: counts.online, active: status === "online" },
    { value: "offline", label: "Offline", count: counts.offline, active: status === "offline" },
    { value: "paused", label: "Paused", count: counts.paused, active: status === "paused" },
    { value: "pool", label: "Unassigned", count: counts.pool, active: status === "pool" },
  ];
  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (status !== "all") params.status = status;

  return (
    <>
      <PageHeader
        title="Devices"
        description={`${formatNumber(counts.all)} printers · ${formatNumber(counts.online)} online`}
      />

      <ListControls initialQ={q} placeholder="Search by device, serial or store…" tabs={tabs} />

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Device</TableHead>
              <TableHead>Store</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last seen</TableHead>
              {canManage && <TableHead className="w-36" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 5 : 4} className="py-10 text-center text-sm text-muted-foreground">
                  {status === "pool" ? "No unassigned devices." : `No devices match${q ? ` "${q}"` : ""}.`}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    {d.storeId ? (
                      <Link href={`/tenant/stores/${d.storeId}/${d.id}`} className="flex flex-col">
                        <span className="font-medium">{d.name}</span>
                        {d.serial && <span className="font-mono text-xs text-muted-foreground">{d.serial}</span>}
                      </Link>
                    ) : (
                      <span className="flex flex-col">
                        <span className="font-medium">{d.name}</span>
                        {d.serial && <span className="font-mono text-xs text-muted-foreground">{d.serial}</span>}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.storeName ?? "—"}</TableCell>
                  <TableCell><StatusBadge status={d.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{timeAgo(d.lastSeen)}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <DeviceListActions deviceId={d.id} deviceName={d.name} storeId={d.storeId} />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <PaginationBar page={page} total={total} pathname="/tenant/devices" params={params} />
    </>
  );
}

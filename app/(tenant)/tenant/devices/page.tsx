import Link from "next/link";
import { Pin } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionHistory } from "@/components/section-history";
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
import { requireSection } from "@/lib/session";
import { formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

// Phone reflow: a cell stops being a table cell and becomes a grid item.
const CELL = "max-sm:block max-sm:h-auto max-sm:p-0!";

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { organizationId, canManage } = await requireSection("devices");
  const { q, status, page } = parseListParams(await searchParams);
  const { rows, total, counts } = await getTenantDevicesPage(organizationId, { q, status, page });

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
        description={`${formatNumber(counts.all)} screens · ${formatNumber(counts.online)} online`}
      >
        <SectionHistory section="devices" className="max-sm:-ml-3 sm:-mr-3" />
      </PageHeader>

      <ListControls initialQ={q} placeholder="Search by device, serial or store…" tabs={tabs} />

      {/* Below 640px the same five columns reflow instead of scrolling sideways:
          device and status, then store over last seen beside the row's button. */}
      <Card className="overflow-hidden py-0">
        <Table className="max-sm:block">
          <TableHeader className="max-sm:sr-only">
            <TableRow className="hover:bg-transparent">
              <TableHead>Device</TableHead>
              <TableHead>Store</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last seen</TableHead>
              {canManage && <TableHead className="w-36" />}
            </TableRow>
          </TableHeader>
          <TableBody className="max-sm:block">
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 5 : 4} className="py-10 text-center text-sm text-muted-foreground">
                  {status === "pool" ? "No unassigned devices." : `No devices match${q ? ` "${q}"` : ""}.`}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((d) => (
                <TableRow
                  key={d.id}
                  className="max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-0.5 max-sm:px-4 max-sm:py-3"
                >
                  <TableCell className={cn(CELL, "h-[55px] py-0 max-sm:col-start-1 max-sm:row-start-1")}>
                    {d.storeId ? (
                      <Link href={`/tenant/stores/${d.storeId}/${d.id}`} className="flex flex-col whitespace-normal">
                        <span className="flex items-center gap-1.5 font-medium">
                          {d.name}
                          {d.pinnedUrl && (
                            <Pin className="size-3.5 shrink-0 stroke-[1.6] text-muted-foreground" aria-label="Pinned QR active" />
                          )}
                        </span>
                        {d.serial && <span className="font-mono text-xs leading-4 tracking-normal text-muted-foreground">{d.serial}</span>}
                      </Link>
                    ) : (
                      <span className="flex flex-col whitespace-normal">
                        <span className="flex items-center gap-1.5 font-medium">
                          {d.name}
                          {d.pinnedUrl && (
                            <Pin className="size-3.5 shrink-0 stroke-[1.6] text-muted-foreground" aria-label="Pinned QR active" />
                          )}
                        </span>
                        {d.serial && <span className="font-mono text-xs leading-4 tracking-normal text-muted-foreground">{d.serial}</span>}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className={cn(CELL, "text-muted-foreground max-sm:col-start-1 max-sm:row-start-2 max-sm:mt-1.5 max-sm:truncate")}>
                    {d.storeName ?? "—"}
                  </TableCell>
                  <TableCell className={cn(CELL, "max-sm:col-start-2 max-sm:row-start-1 max-sm:justify-self-end")}>
                    <StatusBadge status={d.status} />
                  </TableCell>
                  <TableCell className={cn(CELL, "text-muted-foreground max-sm:col-start-1 max-sm:row-start-3")}>
                    {timeAgo(d.lastSeen)}
                  </TableCell>
                  {canManage && (
                    <TableCell
                      className={cn(CELL, "text-right max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-2 max-sm:self-end")}
                    >
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

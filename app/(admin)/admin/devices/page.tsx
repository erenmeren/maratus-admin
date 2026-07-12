import { desc } from "drizzle-orm";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { ListControls } from "@/components/list-controls";
import { PaginationBar } from "@/components/pagination-bar";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAdminDevicesPage } from "@/lib/data";
import { db } from "@/lib/db";
import { firmwareRelease } from "@/lib/db/schema";
import { parseListParams } from "@/lib/list-params";
import { formatNumber, timeAgo } from "@/lib/format";
import { firmwareUpdateAvailable } from "@/lib/device-status";

export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { q, status, page } = parseListParams(await searchParams);
  const { rows, total, counts } = await getAdminDevicesPage({ q, status, page });
  const [latestFw] = await db
    .select({ version: firmwareRelease.version })
    .from(firmwareRelease)
    .orderBy(desc(firmwareRelease.createdAt))
    .limit(1);

  const tabs = [
    { value: "all", label: "All", count: counts.all, active: status === "all" },
    { value: "online", label: "Online", count: counts.online, active: status === "online" },
    { value: "offline", label: "Offline", count: counts.offline, active: status === "offline" },
    { value: "paused", label: "Paused", count: counts.paused, active: status === "paused" },
    { value: "pool", label: "Unassigned", count: counts.pool, active: status === "pool" },
    { value: "unclaimed", label: "Unclaimed", count: counts.unclaimed, active: status === "unclaimed" },
  ];
  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (status !== "all") params.status = status;

  return (
    <>
      <PageHeader
        title="Device Fleet"
        description={`${formatNumber(counts.all)} printers · ${formatNumber(counts.online)} online across every customer`}
      />

      <ListControls
        initialQ={q}
        placeholder="Search by device, serial, store or customer…"
        tabs={tabs}
      />

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Device</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Store</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>Firmware</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {status === "pool"
                    ? "No unassigned devices."
                    : status === "unclaimed"
                      ? "No unclaimed devices."
                      : `No devices match${q ? ` "${q}"` : ""}.`}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    {d.claimed ? (
                      <Link href={`/admin/devices/${d.id}`} className="flex flex-col">
                        <span className="font-medium">{d.name}</span>
                        {d.serial && (
                          <span className="font-mono text-xs text-muted-foreground">{d.serial}</span>
                        )}
                      </Link>
                    ) : (
                      <span className="flex flex-col">
                        <span className="font-medium">{d.name}</span>
                        {d.serial && (
                          <span className="font-mono text-xs text-muted-foreground">{d.serial}</span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{d.orgName}</TableCell>
                  <TableCell className="text-muted-foreground">{d.storeName ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={d.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {d.claimed ? timeAgo(d.lastSeen) : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    v{d.firmwareVersion}
                    {d.claimed && firmwareUpdateAvailable(d.firmwareVersion, latestFw?.version ?? null) && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                        update
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <PaginationBar page={page} total={total} pathname="/admin/devices" params={params} />
    </>
  );
}

import Link from "next/link";
import { ChevronRight, MapPin, Store as StoreIcon } from "lucide-react";
import { StoreRowActions } from "@/components/store-row-actions";
import { PageHeader } from "@/components/page-header";
import { StatusBadge, StatusDot } from "@/components/status-badge";
import { AddStoreDialog } from "@/components/add-store-dialog";
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
import { getTenantStoresPage } from "@/lib/data";
import { requireTenant } from "@/lib/session";
import { canManageTenant } from "@/lib/roles";
import { formatNumber } from "@/lib/format";
import { parseListParams } from "@/lib/list-params";

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { ctx, organizationId } = await requireTenant();
  const { q, page } = parseListParams(await searchParams);
  const { rows: stores, total, fleet } = await getTenantStoresPage(organizationId, { q, page });
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  const canManage = canManageTenant(membership?.role);
  const params: Record<string, string> = {};
  if (q) params.q = q;

  return (
    <>
      <PageHeader
        title="Stores"
        description={`${formatNumber(fleet.stores)} branches · ${formatNumber(fleet.online)}/${formatNumber(fleet.devices)} screens online`}
      >
        {canManage && <AddStoreDialog />}
      </PageHeader>

      <ListControls
        initialQ={q}
        placeholder="Search stores by name or address…"
      />

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Store</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="text-center">Screens</TableHead>
              <TableHead className="text-right">Activations (mo.)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {stores.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No stores match{q ? ` "${q}"` : ""}.
                </TableCell>
              </TableRow>
            ) : (
              stores.map((s) => (
                <TableRow key={s.id} className="group cursor-pointer">
                  <TableCell>
                    <Link
                      href={`/tenant/stores/${s.id}`}
                      className="flex items-center gap-3"
                    >
                      <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                        <StoreIcon className="size-4" />
                      </span>
                      <span className="font-medium">{s.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <MapPin className="size-3.5 shrink-0 opacity-60" />
                      <span className="truncate">{s.address}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center gap-1.5">
                      <StatusDot status={s.status} />
                      <span className="tabular-nums">
                        {s.onlineCount}/{s.deviceCount}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatNumber(s.activationsThisMonth)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage ? (
                      <StoreRowActions
                        store={{
                          id: s.id,
                          name: s.name,
                          address: s.address,
                          timezone: s.timezone,
                        }}
                      />
                    ) : (
                      <Link
                        href={`/tenant/stores/${s.id}`}
                        className="flex justify-end text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      >
                        <ChevronRight className="size-4" />
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <PaginationBar
        page={page}
        total={total}
        pathname="/tenant/stores"
        params={params}
      />
    </>
  );
}

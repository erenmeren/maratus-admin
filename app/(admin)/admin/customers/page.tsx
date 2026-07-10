import Link from "next/link";
import { ChevronRight } from "lucide-react";

const HEALTH_UI: Record<"healthy" | "warning" | "critical", { dot: string; label: string }> = {
  healthy: { dot: "bg-emerald-500", label: "Healthy" },
  warning: { dot: "bg-amber-500", label: "Warning" },
  critical: { dot: "bg-red-500", label: "Critical" },
};
import { PageHeader } from "@/components/page-header";
import { NewCustomerDialog } from "@/components/new-customer-dialog";
import { TenantStatusBadge } from "@/components/tenant-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getTenantSummaries } from "@/lib/data";
import { formatNumber } from "@/lib/format";

type ViewFilter = "active" | "archived" | "all";

const VIEWS: { value: ViewFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const rawView = Array.isArray(raw.view) ? raw.view[0] : raw.view;
  const view: ViewFilter =
    rawView === "archived" || rawView === "all" ? rawView : "active";

  const all = await getTenantSummaries({ includeArchived: view !== "active" });
  const customers =
    view === "archived" ? all.filter((c) => c.archivedAt !== null) : all;

  return (
    <>
      <PageHeader
        title="Customers"
        description={`${customers.length} store chains on Ditto`}
      >
        <NewCustomerDialog />
      </PageHeader>

      <div className="flex w-fit items-center gap-1 rounded-lg border p-1">
        {VIEWS.map((v) => (
          <Link
            key={v.value}
            href={v.value === "active" ? "/admin/customers" : `/admin/customers?view=${v.value}`}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              view === v.value
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
          </Link>
        ))}
      </div>

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Customer</TableHead>
              <TableHead className="text-center">Stores</TableHead>
              <TableHead className="text-center">Devices</TableHead>
              <TableHead className="text-center">Health</TableHead>
              <TableHead className="text-right">Activations (mo.)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((c) => (
              <TableRow key={c.id} className="group cursor-pointer">
                <TableCell>
                  <Link
                    href={`/admin/customers/${c.id}`}
                    className="flex items-center gap-3"
                  >
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 font-display text-sm font-bold text-primary">
                      {c.name.slice(0, 1)}
                    </span>
                    <div>
                      <p className="font-medium">{c.name}</p>
                      {c.archivedAt && (
                        <span className="flex items-center gap-1.5">
                          <Badge variant="secondary" className="text-muted-foreground">
                            Archived
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(c.archivedAt).toLocaleDateString()}
                          </span>
                        </span>
                      )}
                    </div>
                  </Link>
                </TableCell>
                <TableCell className="text-center tabular-nums">
                  {c.storeCount}
                </TableCell>
                <TableCell className="text-center tabular-nums">
                  {c.deviceCount}
                </TableCell>
                <TableCell className="text-center">
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span className={`size-2 rounded-full ${HEALTH_UI[c.health].dot}`} />
                    {HEALTH_UI[c.health].label}
                    <span className="text-muted-foreground">({c.onlineCount}/{c.deviceCount})</span>
                  </span>
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatNumber(c.activationsThisMonth)}
                </TableCell>
                <TableCell>
                  <TenantStatusBadge status={c.status} />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/admin/customers/${c.id}`}
                    className="flex justify-end text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  >
                    <ChevronRight className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

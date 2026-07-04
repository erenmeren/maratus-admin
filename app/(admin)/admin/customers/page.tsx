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
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getTenantSummaries } from "@/lib/data";
import { formatNumber } from "@/lib/format";

export default async function CustomersPage() {
  const customers = await getTenantSummaries();

  return (
    <>
      <PageHeader
        title="Customers"
        description={`${customers.length} store chains on Ditto`}
      >
        <NewCustomerDialog />
      </PageHeader>

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
                    <p className="font-medium">{c.name}</p>
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

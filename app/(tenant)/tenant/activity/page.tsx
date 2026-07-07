import Link from "next/link";
import { requireTenant } from "@/lib/session";
import { getOrgAuditPage } from "@/lib/data";
import { actionLabel } from "@/lib/audit-labels";
import { timeAgo } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { organizationId } = await requireTenant();
  const raw = await searchParams;
  const requested = Math.max(1, Number(raw.page) || 1);
  const { rows, page, pageCount } = await getOrgAuditPage(organizationId, requested);

  return (
    <>
      <PageHeader title="Activity" />

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-6">When</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="pl-6 text-muted-foreground">{timeAgo(e.at)}</TableCell>
                <TableCell className="font-medium">{actionLabel(e.action)}</TableCell>
                <TableCell>
                  {e.actor}
                  {e.actorType !== "user" && (
                    <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                      {e.actorType}
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{e.target ?? "—"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="py-12 text-center text-sm text-muted-foreground">
                  No activity yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Page {page} of {pageCount}</span>
        <span className="flex gap-3">
          {page > 1 ? (
            <Link className="underline" href={`/tenant/activity?page=${page - 1}`}>Previous</Link>
          ) : (
            <span className="text-muted-foreground">Previous</span>
          )}
          {page < pageCount ? (
            <Link className="underline" href={`/tenant/activity?page=${page + 1}`}>Next</Link>
          ) : (
            <span className="text-muted-foreground">Next</span>
          )}
        </span>
      </div>
    </>
  );
}

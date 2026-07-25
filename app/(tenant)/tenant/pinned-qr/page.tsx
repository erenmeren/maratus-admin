import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { PageSection } from "@/components/page-section";
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
import { OrgPinCard } from "@/components/pin/org-pin-card";
import { StorePinTable } from "@/components/pin/store-pin-table";
import { getPinOverview, getOrgQrStyle } from "@/lib/data";
import { getBalance } from "@/lib/credits";
import { requireTenant } from "@/lib/session";
import { canManageTenant } from "@/lib/roles";

export default async function PinnedQrPage() {
  const { ctx, organizationId } = await requireTenant();
  const membership = ctx.organizations.find((o) => o.id === organizationId);
  const canManage = canManageTenant(membership?.role);

  const [overview, qrStyle, balance] = await Promise.all([
    getPinOverview(organizationId),
    getOrgQrStyle(organizationId),
    getBalance(organizationId),
  ]);

  return (
    <>
      <PageHeader
        title="Pinned QR"
        description="One QR your screens show while idle — tenant-wide, per store, or per device."
      />

      <OrgPinCard
        tenant={overview.tenant}
        qrStyle={qrStyle}
        creditsAvailable={balance.available}
        canManage={canManage}
      />

      <PageSection title="Stores">
        <StorePinTable
          stores={overview.stores}
          tenantPinnedUrl={overview.tenant.pinnedUrl}
          creditsAvailable={balance.available}
          canManage={canManage}
        />
        {overview.poolInheritingCount > 0 && (
          <p className="text-sm text-muted-foreground">
            {overview.poolInheritingCount} unassigned device(s) follow the tenant-wide pin.
          </p>
        )}
      </PageSection>

      <PageSection title="Device exceptions">
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Device</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>URL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.exceptions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                    No devices override their store or tenant pin.
                  </TableCell>
                </TableRow>
              ) : (
                overview.exceptions.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={d.storeId ? `/tenant/stores/${d.storeId}/${d.id}` : "/tenant/devices"}
                        className="hover:underline"
                      >
                        {d.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d.storeName ?? "Unassigned"}</TableCell>
                    <TableCell>
                      <Badge variant={d.pinMode === "custom" ? "default" : "outline"}>
                        {d.pinMode === "custom" ? "Custom" : "None"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-64 truncate font-mono text-xs text-muted-foreground">
                      {d.pinnedUrl ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </PageSection>
    </>
  );
}

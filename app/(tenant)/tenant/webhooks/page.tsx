import { PageHeader } from "@/components/page-header";
import { WebhookCreateDialog } from "@/components/webhook-create-dialog";
import { WebhookRowActions } from "@/components/webhook-row-actions";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getWebhookEndpoints, getRecentWebhookDeliveries } from "@/lib/data";
import { requireTenant } from "@/lib/session";

export default async function WebhooksPage() {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  const canManage = !!role && ["owner", "admin"].includes(role);
  const [endpoints, deliveries] = await Promise.all([
    getWebhookEndpoints(organizationId),
    getRecentWebhookDeliveries(organizationId, 20),
  ]);

  return (
    <>
      <PageHeader title="Webhooks" description="Receive signed events when documents are created or viewed.">
        {canManage && <WebhookCreateDialog />}
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Verifying events</CardTitle>
          <CardDescription>
            Each POST carries <code className="font-mono">X-Ditto-Signature: t=&lt;unix&gt;,v1=&lt;hmac&gt;</code> —
            HMAC-SHA256 of <code className="font-mono">&quot;&lt;t&gt;.&lt;raw body&gt;&quot;</code> with your endpoint secret.
            Dedupe on <code className="font-mono">X-Ditto-Event-Id</code> (delivery is at-least-once).
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Endpoint</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last delivery</TableHead>
              {canManage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {endpoints.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 5 : 4} className="py-10 text-center text-sm text-muted-foreground">
                  No endpoints yet.
                </TableCell>
              </TableRow>
            ) : (
              endpoints.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="max-w-xs truncate font-mono text-xs">{e.url}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.events.join(", ")}</TableCell>
                  <TableCell className="text-sm">
                    {e.enabled ? (
                      <span className="text-status-online">Enabled</span>
                    ) : (
                      <span className="text-destructive">Disabled{e.disabledReason ? ` (${e.disabledReason})` : ""}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {e.lastDeliveryAt ? new Date(e.lastDeliveryAt).toLocaleString() : "Never"}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <WebhookRowActions endpointId={e.id} enabled={e.enabled} />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Recent deliveries</h2>
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Event</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    No deliveries yet.
                  </TableCell>
                </TableRow>
              ) : (
                deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">{d.eventType}</TableCell>
                    <TableCell className="max-w-[16rem] truncate font-mono text-xs text-muted-foreground">{d.url}</TableCell>
                    <TableCell className="text-sm">
                      <span className={d.status === "success" ? "text-status-online" : d.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                        {d.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.responseStatus ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.attempts}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(d.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}

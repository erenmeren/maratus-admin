import { PageHeader } from "@/components/page-header";
import { ApiKeyCreateDialog } from "@/components/api-key-create-dialog";
import { ApiKeyRowActions } from "@/components/api-key-row-actions";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getApiKeys } from "@/lib/data";
import { requireTenant } from "@/lib/session";

export default async function ApiKeysPage() {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  const canManage = !!role && ["owner", "admin"].includes(role);
  const keys = await getApiKeys(organizationId);
  const active = keys.filter((k) => !k.revokedAt);

  return (
    <>
      <PageHeader
        title="API keys"
        description="Read-only keys for the Ditto public API."
      >
        {canManage && <ApiKeyCreateDialog />}
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Using the API</CardTitle>
          <CardDescription>
            Base URL <code className="font-mono">/api/v1</code> · authenticate with{" "}
            <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>. Endpoints:{" "}
            <code className="font-mono">GET /documents</code>, <code className="font-mono">GET /documents/&#123;id&#125;</code>,{" "}
            <code className="font-mono">GET /usage</code>. Full schema:{" "}
            <a className="underline" href="/api/v1/openapi.json">/api/v1/openapi.json</a>.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Created</TableHead>
              {canManage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 5 : 4} className="py-10 text-center text-sm text-muted-foreground">
                  No API keys yet.
                </TableCell>
              </TableRow>
            ) : (
              active.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell>
                    <code className="font-mono text-xs text-muted-foreground">{k.prefix}…</code>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "Never"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <ApiKeyRowActions keyId={k.id} name={k.name} />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

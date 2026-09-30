import { PageHeader } from "@/components/page-header";
import { ApiKeyCreateDialog } from "@/components/api-key-create-dialog";
import { ApiKeyRowActions } from "@/components/api-key-row-actions";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getApiKeys } from "@/lib/data";
import { requireTenant } from "@/lib/session";
import { canManageTenant } from "@/lib/roles";

export default async function ApiKeysPage() {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  const canManage = canManageTenant(role);
  const keys = await getApiKeys(organizationId);
  const active = keys.filter((k) => !k.revokedAt);

  return (
    <>
      <PageHeader
        title="API keys"
        description="Keys for the Maratus public API. Each key can read usage, trigger devices or manage pinned QR codes, depending on the scopes you grant it."
      >
        {canManage && <ApiKeyCreateDialog />}
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Using the API</CardTitle>
          <CardDescription>
            Guides, endpoint reference and a live request console are in the API documentation.
          </CardDescription>
          <CardAction>
            <Button asChild>
              <a href="https://docs.maratus.co" target="_blank" rel="noopener noreferrer">
                <BookOpen className="size-4" />
                API documentation
                <ArrowUpRight className="size-4" />
              </a>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Base URL</p>
            <code className="block truncate font-mono">https://api.maratus.co/v1</code>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Authentication</p>
            <code className="block truncate font-mono">Authorization: Bearer &lt;key&gt;</code>
          </div>
        </CardContent>
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

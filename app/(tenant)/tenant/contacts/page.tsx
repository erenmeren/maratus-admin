import { PageHeader } from "@/components/page-header";
import { ContactsExportButton } from "@/components/contacts-export-button";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getMarketingContacts } from "@/lib/data";
import { requireTenant } from "@/lib/session";

export default async function ContactsPage() {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  const canManage = !!role && ["owner", "admin"].includes(role);
  // Customer emails are PII — only owners/admins may see the list or export it.
  const contacts = canManage ? await getMarketingContacts(organizationId) : [];

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Customers who opted in to hear from you."
      >
        {canManage && <ContactsExportButton />}
      </PageHeader>

      {!canManage ? (
        <Card className="px-6 py-10 text-center text-sm text-muted-foreground">
          Only owners and admins can view marketing contacts.
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Email</TableHead>
                <TableHead>Opted in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-10 text-center text-sm text-muted-foreground">
                    No opted-in customers yet.
                  </TableCell>
                </TableRow>
              ) : (
                contacts.map((c) => (
                  <TableRow key={c.email}>
                    <TableCell className="font-medium">{c.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.optInAt.toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}

import { requireTenant } from "@/lib/session";
import { getOrgMembers, getOrgInvitations } from "@/lib/data";
import { canManageMembers } from "@/lib/members";
import { MembersManager } from "@/components/members/members-manager";
import { PageHeader } from "@/components/page-header";

export default async function MembersPage() {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  const [members, invitations] = await Promise.all([
    getOrgMembers(organizationId),
    getOrgInvitations(organizationId),
  ]);

  return (
    <>
      <PageHeader title="Members" />
      <MembersManager members={members} invitations={invitations} canManage={canManageMembers(role)} />
    </>
  );
}

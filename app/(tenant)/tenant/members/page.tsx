import { requireTenant } from "@/lib/session";
import { getOrgMembers, getOrgInvitations } from "@/lib/data";
import { canManageMembers } from "@/lib/members";
import { MembersManager } from "@/components/members/members-manager";

export default async function MembersPage() {
  const { ctx, organizationId } = await requireTenant();
  const role = ctx.organizations.find((o) => o.id === organizationId)?.role;
  const [members, invitations] = await Promise.all([
    getOrgMembers(organizationId),
    getOrgInvitations(organizationId),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
      <MembersManager members={members} invitations={invitations} canManage={canManageMembers(role)} />
    </div>
  );
}

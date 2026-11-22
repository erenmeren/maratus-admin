import { requireSection } from "@/lib/session";
import { getOrgMembers, getOrgInvitations } from "@/lib/data";
import { canManageMembers } from "@/lib/members";
import { MembersManager } from "@/components/members/members-manager";
import { PageHeader } from "@/components/page-header";
import { SectionHistory } from "@/components/section-history";

export default async function MembersPage() {
  const { organizationId, role } = await requireSection("members");
  const [members, invitations] = await Promise.all([
    getOrgMembers(organizationId),
    getOrgInvitations(organizationId),
  ]);

  return (
    <>
      <PageHeader title="Members">
        <SectionHistory section="members" />
      </PageHeader>
      <MembersManager members={members} invitations={invitations} canManage={canManageMembers(role)} />
    </>
  );
}

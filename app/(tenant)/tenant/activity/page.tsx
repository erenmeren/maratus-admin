import { requireTenant } from "@/lib/session";
import { getOrgAuditLog } from "@/lib/data";

export default async function ActivityPage() {
  const { organizationId } = await requireTenant();
  const events = await getOrgAuditLog(organizationId);

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-2">When</th>
              <th>Action</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="py-2">{e.at.slice(0, 19).replace("T", " ")}</td>
                <td>{e.action}</td>
                <td>{e.actor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

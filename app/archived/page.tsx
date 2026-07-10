// Deliberately OUTSIDE the (tenant) route group: app/(tenant)/layout.tsx calls
// requireTenant(), and requireTenant redirects a no-active-org member here.
// If this page lived under (tenant), that same layout gate would re-run on
// every visit and recurse into a redirect loop.
import { getContext } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function ArchivedNoticePage() {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  // If they regained an active (non-archived) org, send them in.
  if (ctx.activeOrganizationId) redirect("/tenant");
  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="font-display text-2xl font-bold">No active organization</h1>
      <p className="text-sm text-muted-foreground">
        You don&apos;t have access to an active organization. If you believe this
        is a mistake, contact your Ditto account manager.
      </p>
    </div>
  );
}

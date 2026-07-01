import { peekLookupToken } from "@/lib/lookup/store";
import { LookupShell, LookupExpired } from "@/components/lookup-shell";
import { LookupConfirm } from "@/components/lookup-confirm";

export default async function Page({
  params,
}: {
  params: Promise<{ orgId: string; token: string }>;
}) {
  const { orgId, token } = await params;

  // GET only validates (peek) — it must never consume the single-use token,
  // otherwise email scanners/link-unfurlers (SafeLinks, Proofpoint, Slack)
  // burn it before the human clicks. Consumption happens only in the
  // confirmLookup server action, invoked via POST from the button below.
  const peek = await peekLookupToken({ organizationId: orgId, rawToken: token });

  if (peek === null) {
    return (
      <LookupShell>
        <LookupExpired orgId={orgId} />
      </LookupShell>
    );
  }

  return <LookupConfirm orgId={orgId} token={token} />;
}

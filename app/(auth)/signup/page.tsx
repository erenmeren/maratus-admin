import { getContext } from "@/lib/session";
import { getInvitationForSignup } from "@/lib/actions/members";
import { SignupForm } from "./signup-form";
import { AcceptInviteForm } from "@/components/members/accept-invite-form";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  if (!invite) return <SignupForm />;

  const inv = await getInvitationForSignup(invite);
  if (!inv) {
    return <p className="p-8 text-center text-sm text-muted-foreground">This invitation is invalid or has expired.</p>;
  }
  const ctx = await getContext();
  const signedInMatch = ctx?.user.email.toLowerCase() === inv.email.toLowerCase();
  const signedInOther = !!ctx && !signedInMatch;

  return (
    <AcceptInviteForm
      invitationId={inv.id}
      email={inv.email}
      orgName={inv.orgName}
      mode={signedInMatch ? "accept" : signedInOther ? "wrong-user" : "signup"}
      currentEmail={ctx?.user.email ?? null}
    />
  );
}

import { redirect } from "next/navigation";
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
  if (!invite) {
    // A signed-in user can't create a new company from here (see registerCompany's
    // guard) — send them to their dashboard instead of showing a dead-end form.
    const ctx = await getContext();
    if (ctx) redirect(ctx.user.role === "platform_admin" ? "/admin" : "/tenant");
    return <SignupForm />;
  }

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

import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/session";
import { getInvitationForSignup } from "@/lib/actions/members";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth-shell";
import { AcceptInviteForm } from "@/components/members/accept-invite-form";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  if (!invite) {
    // Invite-only: there is no self-serve sign-up. Without an invitation token
    // this route has nothing to show — signed-in visitors go to their
    // workspace, everyone else to sign-in. The account-creating half of this
    // page lives on only for invitees (AcceptInviteForm, below); the server
    // side of that door is lib/signup-gate.ts.
    const ctx = await getContext();
    if (ctx) redirect(ctx.user.role === "platform_admin" ? "/admin" : "/tenant");
    redirect("/login");
  }

  const inv = await getInvitationForSignup(invite);
  if (!inv || inv.state === "accepted") {
    const used = inv?.state === "accepted";
    return (
      <AuthShell
        panelTitle="Your team is already here."
        panelCopy="Accept your invitation and start managing stores, screens, and triggered content together."
        panelStats={[
          { k: "1 min", v: "to join" },
          { k: "0", v: "paper printed" },
          { k: "∞", v: "things to show" },
        ]}
      >
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {used ? "Invitation already accepted" : "Invitation not found"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {used
              ? "This invitation has already been used — your account is set up. Sign in to get to your workspace."
              : "This invitation is invalid or has expired. Ask a workspace admin to send you a new one — invitation links only work once."}
          </p>
        </div>
        <Button variant={used ? "default" : "outline"} className="w-full" asChild>
          <Link href="/login">Go to sign in</Link>
        </Button>
      </AuthShell>
    );
  }
  const ctx = await getContext();
  const signedInMatch = ctx?.user.email.toLowerCase() === inv.email.toLowerCase();
  const signedInOther = !!ctx && !signedInMatch;

  return (
    <AcceptInviteForm
      invitationId={inv.id}
      email={inv.email}
      orgName={inv.orgName}
      mode={
        signedInMatch
          ? "accept"
          : signedInOther
            ? "wrong-user"
            : inv.hasAccount
              ? "needs-signin"
              : "signup"
      }
      currentEmail={ctx?.user.email ?? null}
    />
  );
}

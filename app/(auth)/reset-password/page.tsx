import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

// Shared brand-panel copy for both states of this route. Defined server-side and
// passed down as plain (serializable) props — nothing crosses the RSC boundary
// that shouldn't.
const RESET_PANEL = {
  panelTitle: "One new password and you're back.",
  panelCopy:
    "Pick something only you know. We'll sign you in from the login page and everything is exactly where you left it.",
  panelStats: [
    { k: "8+", v: "characters, please" },
    { k: "1 hr", v: "link validity" },
    { k: "1", v: "use per link" },
  ],
};

/**
 * Landing page for the emailed reset link.
 *
 * Better Auth's `/api/auth/reset-password/{token}` callback validates the token
 * first, then bounces here with either `?token=…` (good) or
 * `?error=INVALID_TOKEN` (missing/expired/already used).
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  if (!token || error) {
    return (
      <AuthShell {...RESET_PANEL}>
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold tracking-tight">
            This reset link doesn&apos;t work
          </h1>
          <p className="text-sm text-muted-foreground">
            It may have expired, already been used, or been copied incompletely.
            Reset links are good for one hour and one use — request a fresh one
            and we&apos;ll email it right away.
          </p>
        </div>
        <div className="space-y-3">
          <Button className="w-full" asChild>
            <Link href="/forgot-password">
              Request a new link
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button variant="ghost" className="w-full" asChild>
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return <ResetPasswordForm token={token} panel={RESET_PANEL} />;
}

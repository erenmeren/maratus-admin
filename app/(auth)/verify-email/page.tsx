import { VerifyEmailNotice } from "./verify-email-notice";

// Shown when a sign-up left the account unverified and email verification is
// active. Self-serve sign-up is gone (invite-only), so this is reached only
// from Better Auth verification links.
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  return <VerifyEmailNotice email={email} />;
}

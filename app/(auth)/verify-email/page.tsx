import { VerifyEmailNotice } from "./verify-email-notice";

// Shown after self-serve signup when email verification is active.
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  return <VerifyEmailNotice email={email} />;
}

// Email-verification gate. Real "check your email" verification is only enforced
// when transactional email can actually be delivered — i.e. when RESEND_API_KEY
// is configured. Invite acceptance auto-verifies either way (the invitation
// already proves inbox ownership — see acceptInviteSignup in
// lib/actions/members.ts), so local/seed/dev users still land in the dashboard.
//
// Pure (IO-free): the caller passes the key (e.g. getEnv().RESEND_API_KEY).
export function emailVerificationEnabled(resendApiKey: string | undefined): boolean {
  return Boolean(resendApiKey && resendApiKey.trim().length > 0);
}

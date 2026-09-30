// Pure builders for the account emails: password reset, email verification,
// and the two invitation flavours (tenant admin inviting a teammate, platform
// admin inviting a new customer's owner). Inviter/org names are user-controlled
// → escaped here; subjects get CR/LF stripped so a name can't inject headers.
import {
  emailAccent,
  emailButton,
  emailEyebrow,
  emailFallback,
  emailHeading,
  emailLayout,
  emailNote,
  emailStrong,
  emailText,
  escapeHtml,
} from "@/lib/billing/invoice-emails";

type Mail = { subject: string; html: string };

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");

/** "in 1 hour" / "in 48 hours" / "in 7 days" from a remaining duration. */
export function expiresInLabel(ms: number): string {
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  if (hours < 48 || hours % 24 !== 0) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = hours / 24;
  return `in ${days} days`;
}

export function resetPasswordEmail(input: { url: string; expiresIn: string }): Mail {
  const subject = "Reset your Maratus password";
  const body =
    emailEyebrow("Password reset") +
    emailHeading(`Let’s get you ${emailAccent("back in.")}`) +
    emailText("We got a request to reset the password on your Maratus account. Choose a new one below.") +
    emailButton(input.url, "Choose a new password") +
    emailNote(`This link expires ${escapeHtml(input.expiresIn)} and works once.`) +
    emailFallback({
      href: input.url,
      ignore: "Didn’t ask for this? You can ignore this email — your password stays the same.",
    });
  return {
    subject,
    html: emailLayout(body, {
      title: subject,
      preheader: `Choose a new password for your Maratus account. The link expires ${escapeHtml(input.expiresIn)}.`,
    }),
  };
}

export function verifyEmailEmail(input: { url: string; email: string; expiresIn: string }): Mail {
  const subject = "Confirm your email for Maratus";
  const body =
    emailEyebrow("Confirm your email") +
    emailHeading(`One quick ${emailAccent("handoff.")}`) +
    emailText(
      `Please confirm that ${emailStrong(escapeHtml(input.email))} is your address so we can finish setting up your account.`,
    ) +
    emailButton(input.url, "Confirm email") +
    emailNote(`This link expires ${escapeHtml(input.expiresIn)}.`) +
    emailFallback({ href: input.url, ignore: "Didn’t create a Maratus account? You can ignore this email." });
  return {
    subject,
    html: emailLayout(body, {
      title: subject,
      preheader: "One quick step: confirm your email address to finish setting up Maratus.",
    }),
  };
}

export function memberInviteEmail(input: {
  url: string;
  inviterName: string;
  orgName: string;
  role: string;
  expiresIn: string;
}): Mail {
  const inviter = escapeHtml(input.inviterName);
  const org = escapeHtml(input.orgName);
  const role = escapeHtml(input.role);
  const subject = `You're invited to ${oneLine(input.orgName)} on Maratus`;
  const body =
    emailEyebrow("You’re invited") +
    emailHeading(`${inviter} saved you ${emailAccent("a seat.")}`) +
    emailText(
      `You’ve been invited to join ${emailStrong(org)} on Maratus as ${emailStrong(role)}, ` +
        `where you’ll manage what customers see at the counter.`,
    ) +
    emailButton(input.url, "Accept invite") +
    emailNote(`This invite expires ${escapeHtml(input.expiresIn)}.`) +
    emailFallback({
      href: input.url,
      ignore: "Not expecting this? You can safely ignore it. No account is created until you accept.",
    });
  return {
    subject,
    html: emailLayout(body, {
      title: "You’re invited to Maratus",
      preheader: `${inviter} invited you to join ${org} on Maratus.`,
    }),
  };
}

export function ownerInviteEmail(input: { url: string; orgName: string; expiresIn: string }): Mail {
  const org = escapeHtml(input.orgName);
  const subject = `You're invited to own ${oneLine(input.orgName)} on Maratus`;
  const body =
    emailEyebrow("Welcome to Maratus") +
    emailHeading(`Your counter, ${emailAccent("your keys.")}`) +
    emailText(
      `The Maratus team set up ${emailStrong(org)} for you. Accept the invite to create your account — ` +
        `as the owner you’ll manage your stores, devices, team and billing.`,
    ) +
    emailButton(input.url, "Accept invite") +
    emailNote(`This invite expires ${escapeHtml(input.expiresIn)}.`) +
    emailFallback({
      href: input.url,
      ignore: "Not expecting this? You can safely ignore it. No account is created until you accept.",
    });
  return {
    subject,
    html: emailLayout(body, {
      title: "You’re invited to Maratus",
      preheader: `The Maratus team invited you to own ${org} on Maratus.`,
    }),
  };
}

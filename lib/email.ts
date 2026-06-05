// Thin transactional-email wrapper. No-ops (logs) when RESEND_API_KEY is unset
// so local/seed flows don't break — the verification URL is still printed to the
// server console, which is enough to click through in development.
//
// NEVER throws: a transactional-email failure (bad key, Resend 4xx/5xx, network
// blip) must not break the surrounding transaction — e.g. a failed verification
// email should not fail the sign-up that triggered it. Failures are logged and
// reported to Sentry, and the boolean return says whether the mail went out.

import { getEnv } from "./env";
import { reportError } from "./observability";

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  const env = getEnv();
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[email] RESEND_API_KEY unset — would send "${subject}" to ${to}`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] Resend failed: ${res.status} ${body}`);
      // subject is safe context; omit `to`/`html` (recipient PII + content).
      reportError(new Error(`Resend ${res.status}: ${body}`), {
        path: "email.send",
        extra: { subject, status: res.status },
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email] send threw for "${subject}"`, err);
    reportError(err, { path: "email.send", extra: { subject } });
    return false;
  }
}

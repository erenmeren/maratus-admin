// Thin transactional-email wrapper. No-ops (logs) when RESEND_API_KEY is unset
// so local/seed flows don't break — the verification URL is still printed to the
// server console, which is enough to click through in development.

import { getEnv } from "./env";

export async function sendEmail(to: string, subject: string, html: string) {
  const env = getEnv();
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[email] RESEND_API_KEY unset — would send "${subject}" to ${to}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
}

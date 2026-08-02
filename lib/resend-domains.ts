// The one IO half of the email-configuration check: ask Resend which domains
// this account has. Kept out of lib/integration-status.ts so the decision logic
// stays pure and unit-testable.
//
// Returns null on ANY failure (no key, restricted key, network, non-2xx, bad
// shape). Null is not "no domains" — it means "unknown", and emailStatus() is
// written to never report a green state from it. An admin page must not turn a
// lookup failure into a claim that mail works.

import { env } from "@/lib/env";

export interface ResendDomain {
  name: string;
  status: string;
}

export async function fetchResendDomains(): Promise<ResendDomain[] | null> {
  const key = env.RESEND_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const data = (json as { data?: unknown })?.data;
    if (!Array.isArray(data)) return null;
    return data.flatMap((d) => {
      const name = (d as { name?: unknown })?.name;
      const status = (d as { status?: unknown })?.status;
      return typeof name === "string" ? [{ name, status: typeof status === "string" ? status : "unknown" }] : [];
    });
  } catch {
    return null;
  }
}

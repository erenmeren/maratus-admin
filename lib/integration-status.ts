// Configuration status for the two integrations that fail SILENTLY when they are
// half-configured — which is exactly how both sat unnoticed for weeks.
//
// Email is the dangerous one. lib/email.ts only no-ops when RESEND_API_KEY is
// absent; with a key present it really calls Resend, and Resend really refuses
// anything sent from its shared `onboarding@resend.dev` sender to an address
// other than the account owner's. So the "configured" state and the "reaches
// customers" state are not the same thing, and nothing in the app said so.
//
// Pure (IO-free) so it stays unit-testable: the caller passes env values and,
// optionally, the domain list fetched from Resend (lib/resend-domains.ts).

export type EmailState = "disabled" | "sandbox" | "unverified" | "unknown" | "ready";

export interface EmailStatus {
  state: EmailState;
  /** The address mail would be sent from, for display. */
  sender: string;
  /** One sentence, written for whoever has to fix it. */
  detail: string;
}

export const SANDBOX_SENDER_DOMAIN = "resend.dev";

/** `Ditto <noreply@ditto.app>` → `ditto.app`; a bare address works too. */
export function senderDomain(from: string): string | null {
  const angle = from.match(/<([^>]+)>/);
  const address = (angle ? angle[1] : from).trim();
  const at = address.lastIndexOf("@");
  if (at < 0 || at === address.length - 1) return null;
  return address.slice(at + 1).toLowerCase();
}

export function emailStatus(opts: {
  apiKey: string | undefined;
  from: string;
  /** Verified-domain names from Resend, or null when the lookup failed/was skipped. */
  domains: { name: string; status: string }[] | null;
}): EmailStatus {
  const sender = opts.from;
  if (!opts.apiKey || !opts.apiKey.trim()) {
    return {
      state: "disabled",
      sender,
      detail: "RESEND_API_KEY is unset — every send is skipped and logged instead.",
    };
  }

  const domain = senderDomain(opts.from);
  if (!domain || domain === SANDBOX_SENDER_DOMAIN || domain.endsWith(`.${SANDBOX_SENDER_DOMAIN}`)) {
    return {
      state: "sandbox",
      sender,
      detail:
        "Sending from Resend's shared test sender, which only delivers to the Resend account owner. Mail to customers is accepted by the app and refused by Resend. Verify a domain, then set EMAIL_FROM.",
    };
  }

  if (opts.domains === null) {
    return {
      state: "unknown",
      sender,
      detail: "Custom sender set, but the Resend domain list could not be read — verification is unconfirmed.",
    };
  }

  const match = opts.domains.find((d) => d.name.toLowerCase() === domain);
  if (!match) {
    return {
      state: "unverified",
      sender,
      detail: `EMAIL_FROM uses ${domain}, which is not a domain on this Resend account — sends will be refused.`,
    };
  }
  if (match.status !== "verified") {
    return {
      state: "unverified",
      sender,
      detail: `${domain} is on the Resend account but its status is "${match.status}" — finish DNS verification.`,
    };
  }
  return { state: "ready", sender, detail: `${domain} is verified with Resend.` };
}

export type StripeMode = "unset" | "test" | "live";

/** Which Stripe account the deployment is wired to. Test-mode keys never move real money. */
export function stripeMode(secretKey: string | undefined): StripeMode {
  const k = secretKey?.trim() ?? "";
  if (!k) return "unset";
  return k.startsWith("sk_live_") || k.startsWith("rk_live_") ? "live" : "test";
}

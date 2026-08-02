// components/admin/integration-health-card.tsx
// Email + payments configuration, surfaced because both fail quietly: a half-set
// Resend is accepted by the app and refused by Resend, and a test-mode Stripe key
// takes bookings that never move money. Neither shows up anywhere else.
//
// The host page owns the heading (a PageSection h2, like every other section on
// /admin/health), so this card is deliberately header-less.

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { env } from "@/lib/env";
import { emailStatus, stripeMode, type EmailState, type StripeMode } from "@/lib/integration-status";
import { fetchResendDomains } from "@/lib/resend-domains";

// Only a verified custom sender / a live key is "ok"; everything else is called
// out. "unknown" stays neutral — an unread domain list is not evidence of a fault.
const EMAIL_TONE: Record<EmailState, "secondary" | "destructive" | "outline"> = {
  ready: "secondary",
  sandbox: "destructive",
  unverified: "destructive",
  disabled: "outline",
  unknown: "outline",
};
const EMAIL_LABEL: Record<EmailState, string> = {
  ready: "delivering",
  sandbox: "owner-only",
  unverified: "unverified domain",
  disabled: "off",
  unknown: "unconfirmed",
};
const STRIPE_TONE: Record<StripeMode, "secondary" | "destructive" | "outline"> = {
  live: "secondary",
  test: "destructive",
  unset: "outline",
};

function Row({
  label,
  value,
  badge,
  tone,
  detail,
}: {
  label: string;
  value: string;
  badge: string;
  tone: "secondary" | "destructive" | "outline";
  detail: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span>{label}</span>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">{value}</span>
          <Badge variant={tone}>{badge}</Badge>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

export async function IntegrationHealthCard() {
  const domains = await fetchResendDomains();
  const email = emailStatus({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, domains });
  const mode = stripeMode(env.STRIPE_SECRET_KEY);

  return (
    <Card>
      <CardContent className="space-y-4">
        <Row
          label="Transactional email"
          value={email.sender}
          badge={EMAIL_LABEL[email.state]}
          tone={EMAIL_TONE[email.state]}
          detail={email.detail}
        />
        <Row
          label="Payments"
          value={mode === "unset" ? "no key" : `Stripe ${mode} mode`}
          badge={mode === "live" ? "live" : mode === "test" ? "test mode" : "off"}
          tone={STRIPE_TONE[mode]}
          detail={
            mode === "live"
              ? "Charges and subscriptions run against the live Stripe account."
              : mode === "test"
                ? "Wired to a test-mode Stripe account: checkouts succeed but no money moves. Swap in live keys and live price IDs before selling."
                : "STRIPE_SECRET_KEY is unset — billing actions are inert."
          }
        />
      </CardContent>
    </Card>
  );
}

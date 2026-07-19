// components/billing/buy-credits-form.tsx
// Self-serve credit-pack purchase via Stripe Checkout Elements.
// Mirrors the PaymentMethodForm pattern: server action → clientSecret → Elements.
"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  CheckoutElementsProvider,
  PaymentElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";
import { Button } from "@/components/ui/button";
import { startCreditCheckout } from "@/app/(tenant)/tenant/billing/actions";
import type { CreditPack } from "@/lib/billing/credit-packs";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

function CreditCheckoutForm() {
  const state = useCheckoutElements();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (state.type === "loading") {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (state.type === "error") {
    return <p className="text-sm text-destructive">{state.error.message}</p>;
  }
  const checkout = state.checkout;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setConfirming(true);
    setError(null);
    const result = await checkout.confirm({ redirect: "if_required" });
    if (result.type === "error") setError(result.error.message);
    else window.location.reload();
    setConfirming(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={confirming}>
        {confirming ? "Processing…" : "Pay now"}
      </Button>
    </form>
  );
}

interface Props {
  packs: CreditPack[];
  availableCredits: number;
  canManage?: boolean;
}

export function BuyCreditsSection({
  packs,
  availableCredits,
  canManage = true,
}: Props) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [activePack, setActivePack] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!stripePromise || packs.length === 0) {
    return null;
  }

  // Members are read-only for billing: show the balance but no purchase controls.
  if (!canManage) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Credits</h2>
        <p className="text-sm text-muted-foreground">
          Available:{" "}
          <span className="font-medium text-foreground">{availableCredits}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Only owners and admins can buy credits.
        </p>
      </section>
    );
  }

  async function buy(packId: string) {
    setError(null);
    setLoading(packId);
    try {
      const { clientSecret } = await startCreditCheckout(packId);
      setActivePack(packId);
      setClientSecret(clientSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Credits</h2>
      <p className="text-sm text-muted-foreground">
        Available:{" "}
        <span className="font-medium text-foreground">{availableCredits}</span>
      </p>

      {clientSecret && activePack ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            Purchasing{" "}
            <span className="font-medium">
              {packs.find((p) => p.id === activePack)?.credits ?? 0} credits
            </span>
          </p>
          <CheckoutElementsProvider
            stripe={stripePromise}
            options={{ clientSecret }}
          >
            <CreditCheckoutForm />
          </CheckoutElementsProvider>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setClientSecret(null);
              setActivePack(null);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {packs.map((pack) => (
              <Button
                key={pack.id}
                variant="outline"
                disabled={loading !== null}
                onClick={() => buy(pack.id)}
              >
                {loading === pack.id ? "Loading…" : `Buy ${pack.credits} credits`}
              </Button>
            ))}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </section>
  );
}

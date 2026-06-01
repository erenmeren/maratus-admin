// components/billing/payment-method-form.tsx
"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  CheckoutElementsProvider,
  PaymentElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";
import { Button } from "@/components/ui/button";
import { activateBilling } from "@/app/(tenant)/tenant/billing/actions";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

function CheckoutForm() {
  const state = useCheckoutElements();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (state.type === "loading") {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (state.type === "error") {
    return <p className="text-sm text-destructive">{state.error.message}</p>;
  }
  const checkout = state.checkout;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const result = await checkout.confirm({ redirect: "if_required" });
    if (result.type === "error") setError(result.error.message);
    else window.location.reload();
    setSaving(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Subscribe"}
      </Button>
    </form>
  );
}

export function PaymentMethodForm() {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function start() {
    setLoading(true);
    const { clientSecret } = await activateBilling();
    setClientSecret(clientSecret);
    setLoading(false);
  }

  if (!stripePromise) {
    return <p className="text-sm text-muted-foreground">Billing isn’t configured yet.</p>;
  }
  if (!clientSecret) {
    return (
      <Button onClick={start} disabled={loading}>
        {loading ? "Starting…" : "Activate billing"}
      </Button>
    );
  }
  return (
    <CheckoutElementsProvider stripe={stripePromise} options={{ clientSecret }}>
      <CheckoutForm />
    </CheckoutElementsProvider>
  );
}

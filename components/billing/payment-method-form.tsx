// components/billing/payment-method-form.tsx
"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { activateBilling } from "@/app/(tenant)/tenant/billing/actions";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

function CardForm() {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    setError(null);
    const { error } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/tenant/billing` },
      redirect: "if_required",
    });
    if (error) setError(error.message ?? "Could not save card");
    else window.location.reload();
    setSaving(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={!stripe || saving}>
        {saving ? "Saving…" : "Save card"}
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
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CardForm />
    </Elements>
  );
}

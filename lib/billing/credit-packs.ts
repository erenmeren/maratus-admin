// lib/billing/credit-packs.ts
// Parse credit-pack definitions from STRIPE_CREDIT_PACK_PRICE_IDS env var.
// Format: comma-separated `packId:priceId:credits`, e.g.
//   small:price_abc123:100,large:price_def456:1000

import { getEnv } from "@/lib/env";

export interface CreditPack {
  id: string;
  priceId: string;
  credits: number;
}

export function creditPacks(): CreditPack[] {
  const raw = getEnv().STRIPE_CREDIT_PACK_PRICE_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [id, priceId, credits] = s.split(":");
      return { id, priceId, credits: Number(credits) };
    })
    .filter(
      (p) => p.id && p.priceId && Number.isFinite(p.credits) && p.credits > 0,
    );
}

export function findPack(id: string): CreditPack | undefined {
  return creditPacks().find((p) => p.id === id);
}

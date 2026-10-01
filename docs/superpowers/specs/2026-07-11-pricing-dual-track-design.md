# Maratus Pricing — Dual-Track Strategy (Flat Fleet ∥ Base + Usage)

**Date:** 2026-07-11
**Status:** Approved (design)
**Scope:** Commercial pricing model, hardware policy, sales policy for the Turkish
chain opportunity, and the product/engineering implications. Two pricing tracks
run in parallel; convergence to one model is a later, data-driven decision.

## Context & unit economics

### Cost structure (measured from the codebase)

- The firmware polls `GET /api/device/commands` every **12 seconds** while idle
  (`app_state.c` → `POLL_IDLE_MS 12000`), 24/7 → **~7,200 Vercel invocations per
  device per day**, independent of trigger volume.
- A trigger's marginal cost is ~$0.000002 (one API call + a few Neon rows).
  R2 egress is free (Cloudflare); branding assets are cached on-device.
- Estimated infra cost: **~$0.30–0.90 per device per month** (Vercel Fluid
  invocations + CPU/memory, Neon compute). A 2,000-device fleet sustains
  ~167 req/s of polling ≈ $600–1,800/month total.

**Key insight: cost scales with fleet size (device count), not trigger volume.**
A shop firing 5,000 triggers/day costs Maratus almost the same as one firing 10/day.
Pure per-trigger pricing is therefore structurally mispriced: idle devices lose
money, busy shops perceive the price as "more expensive than paper".

### Value anchor (what the customer compares against)

- Thermal receipt cost: **~$0.002–0.004 per receipt** (roll + printer wear).
- A busy shop (5,000 receipts/day) spends **~$300–600/month** on paper.
- A 2,000-shop chain plausibly spends **$150–400K/month** chain-wide.
- Additional value: ESG/paperless corporate story, and digital contact with the
  end customer at QR-scan time (campaigns, loyalty, data).

Sales narrative in all tracks: *"below your paper spend, plus you gain data."*

### Commercial context

- UK-based entity, **USD pricing**. Real chain candidate in Turkey
  (~2,000 shops; some shops peak at ~5,000 transactions/day).
- Device BOM (custom PCB at volume): **~$30–60**.
- Current system: prepaid credit ledger, 1 trigger = 1 credit, Stripe credit
  packs (starter/growth/scale) — reusable as-is by Track C.

## Shared foundation (applies to both tracks)

- **Billing axis is the device.** Both tracks bill a per-device monthly line;
  the tracks differ only in whether usage is metered on top.
- **Hardware policy:** self-service buys the device at **$99 one-time**;
  enterprise/committed contracts (24–36 months) get devices **free** with a
  failure-replacement SLA.
- **Fair-use ceiling:** 300,000 triggers/device/month (~10K/day) — double the
  observed busy-shop peak; exists to close the "pump the API for other
  purposes" loophole, not to bill against.
- **Currency/entity:** USD contracts from the UK entity, including the Turkish
  chain.

## Track B — "Flat Fleet": per-device subscription, unlimited triggers

| Tier | Per device/month (monthly) | Per device/month (annual) |
|---|---|---|
| 1–9 devices | $19 | $15 |
| 10–99 | $15 | $12 |
| 100–999 | $10 | $8 |
| 1,000+ | negotiated | $4–6 |

- Unlimited triggers within fair-use.
- Stripe: quantity-based subscription (quantity = active device count),
  synced monthly.
- Chain outcome at $5/device: **~$120K ARR, ~88% gross margin**.
- Strengths: matches the cost structure exactly, predictable MRR,
  procurement-friendly, no per-receipt anxiety.
- Weakness: captures none of the usage upside at high-volume shops.

## Track C — "Base + Usage": low base + included quota + overage credits

- Base: **$7/device/month** (100+ devices: $5; 1,000+: $3), includes
  **2,000 triggers/month** per device.
- Overage is paid with the **existing credit system** (no new billing infra):
  tiered pack pricing $0.005 (small) → $0.003 (100K) → $0.002 (1M+) per credit.
- Busy shop (150K triggers/month): $3 base + ~148K × $0.002 ≈ **~$300/month** —
  deliberately at/below that shop's paper spend ("sub-parity" pricing).
- Strengths: idle devices never lose money; captures usage upside; reuses the
  shipped credit ledger + Stripe packs.
- Weaknesses: two negotiation knobs, bill-shock risk, meters usage the product
  actually wants to maximize (every scan = marketing value).

## Revenue simulation — the real difference between tracks

2,000-shop chain, average ~1,000 triggers/day/shop:

| | Track B | Track C |
|---|---|---|
| Monthly revenue | ~$10K | ~$6K base + ~$120K usage ≈ **$126K** |
| Annual | ~$120K | **~$1.5M** |
| Share of chain's paper spend | ~3% | ~40% |

Commercial use of the parallel tracks: **open enterprise negotiations with
Track C** (anchored to paper savings); **fall back toward Track B** if the
negotiation stalls. B is the internal price floor; C is the opening offer.

## Sales policy

1. **Pilot:** 50–100 shops, 3 months, paid at Track C pricing; written success
   criteria (scan rate, paper-savings report).
2. **Rollout:** annual contract, free devices on 36-month commitment,
   volume tier applied.
3. **Self-service channel:** Track C by default (base + credit packs — the
   Stripe credit infra already exists); Track B appears as an
   "annual, unlimited" toggle.
4. **Convergence criteria (review at 6–12 months):** win rate, ARPU, churn,
   negotiation friction, and the actual usage distribution decide which single
   model survives.

## Product / engineering implications

- **Both tracks:** per-org active-device counter + Stripe subscription sync;
  monthly per-device usage rollup (source data already exists in
  `device_command` where `type='trigger' AND status='acked'`).
- **Track C:** the credit ledger is reframed as the overage mechanism — the
  `reserveCredit` flow gains an "included quota first, credits after" layer.
- **Margin protection (independent of track):** adaptive polling — 12s while
  the store is open, ~60s during closed hours — cuts polling infra cost
  50–70% at fleet scale with zero customer-visible impact.

## Out of scope (this design)

- Concrete Stripe product/price object layout and webhook changes.
- TRY-denominated pricing or Turkish-entity invoicing.
- Reseller/POS-vendor channel pricing.
- End-customer (scanner-side) monetization.

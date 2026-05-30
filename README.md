# Ditto — Admin Console (Frontend Prototype)

Polished frontend prototype for **Ditto**, a digital-receipt SaaS. Stores install
kiosk devices that replace paper receipts with a QR code customers scan to download
a digital receipt.

This is a **UI prototype with mock data** — no backend yet, but structured so a real
API can be wired in by changing one file.

## Stack

- **Next.js** (App Router) + **TypeScript**
- **Tailwind v4** + **shadcn/ui** (radix-based, Neutral base)
- **recharts** for charts, **next-themes** for light/dark, **lucide-react** icons
- Brand accent: a single emerald `--primary` token on the app chrome.
  > A store's own brand color is **data**, shown only inside the tenant Branding
  > screen — never in the app chrome.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
```

Login is UI-only (no auth). From `/login` you can enter the **Tenant** workspace or
the **Super Admin** panel; a workspace switcher in the sidebar moves between them.

## Routes

| Area | Route | Notes |
| --- | --- | --- |
| Auth | `/login` | Wordmark, email/password, SSO, panel shortcuts |
| Tenant | `/tenant` | Dashboard: KPIs, eco impact, receipts chart |
| Tenant | `/tenant/stores` · `/tenant/stores/[storeId]` · `/tenant/stores/[storeId]/[deviceId]` | Store → device hierarchy |
| Tenant | `/tenant/branding` | Logo upload, accent picker, staff PIN, **live 720×720 kiosk preview** |
| Tenant | `/tenant/reports` | Receipts, store/device breakdowns, eco over time, export (stub) |
| Admin | `/admin` | Platform overview: MRR, receipts, fleet, top customers |
| Admin | `/admin/customers` · `/admin/customers/[tenantId]` | Customer table + create dialog, detail |
| Admin | `/admin/devices` | Global device fleet with customer/status filters |
| Admin | `/admin/billing` | Pricing, amounts owed, invoices, revenue |
| Public | `/r/[token]` | Stub customer receipt page |

## Wiring a real API

All data flows through a thin layer in **`lib/data.ts`** (functions like
`getTenantDashboard()`, `getAllDevices()`, `getBillingOverview()`). Replace the
bodies there with real API calls — every screen keeps working. Markers:
`// TODO: replace with API`.

- `lib/types.ts` — domain types (`Tenant`, `Store`, `Device`, `Invoice`, …)
- `lib/mock-data.ts` — the stand-in dataset (a coffee chain, "Roastwell Coffee")
- `lib/eco.ts` — centralized eco math with clearly-labeled **PLACEHOLDER** constants
  (grams of paper, liters of water, grams of CO₂ per receipt) — refine later.

## Components of note

- `components/device-preview/` — the reusable 720×720 kiosk mockup (idle + QR
  screens), used by the Branding live preview.
- `components/charts.tsx` — themed recharts wrappers (area / line / bar).
- `components/app-shell.tsx` — one shell per panel (sidebar + top bar + theme toggle).

# README rewrite — product-first README + separate development guide

**Date:** 2026-07-21
**Status:** Approved (brainstorming session)

## Goal

The current `README.md` is written entirely for developers (stack, env vars,
architecture, API flows). Rewrite it as a non-technical, product-first document
that any newcomer (customer, partner, non-technical stakeholder, or developer)
can read, and move **all** technical content into a new `docs/DEVELOPMENT.md`
with no loss of content.

## Decisions

- **Audience:** mixed — README speaks to everyone; developers get a single link
  to the development guide at the bottom.
- **Language:** English (consistent with the rest of the repo; Turkish user
  manuals already live in `docs/manuals`).
- **Approach:** "Product-first, single link" — README contains zero code, env
  vars, or commands.
- **Naming:** the product keeps the name **Maratus** (rename decision is
  deferred; see `docs/naming-candidates.md`).

## New `README.md` structure (~60–80 lines, no technical jargon)

1. **Title + tagline** — one sentence, e.g. "Maratus turns paper documents into
   scannable QR codes at the point of sale."
2. **The problem / what Maratus does** — stores print paper documents; Maratus's
   small touch-screen counter device shows a QR code instead; the customer
   scans it with their phone and gets the digital content. The business hosts
   its own content — Maratus only triggers and displays (framed in plain words as
   a privacy plus).
3. **How it works** — a 4-step conceptual story: device comes out of the box →
   connects to Wi-Fi and identifies itself (zero-touch setup) → your sales
   system says "show this link" → the customer scans the QR. No credits,
   commands, or hashes mentioned.
4. **Who uses it** — the two panels in plain language:
   - Store chains: manage stores, devices, screen branding, credit balance,
     team members.
   - Maratus operations: customers, the device fleet, manufacturing inventory,
     software updates.
5. **Pricing in one paragraph** — prepaid credits; each successful QR display
   costs 1 credit; failed displays are not charged.
6. **For developers** — one line linking to `docs/DEVELOPMENT.md` (setup,
   architecture, API) and `docs/device-protocol.md` (device protocol).

## New `docs/DEVELOPMENT.md`

All technical content of the current README moves here verbatim (light edits
only): Stack, Setup, Environment table, Seed accounts, Commands, Architecture,
Device → trigger → QR flow, Factory registry & zero-touch provisioning,
Customer lifecycle (offboarding & archive), Billing (prepaid credits), Testing.

- Title becomes "Maratus — Development Guide".
- Add a one-line back-link to the README at the top.
- Relative links inside the moved content (e.g. `docs/device-protocol.md`,
  `docs/runbooks/...`) must be re-based for the new location (now siblings
  under `docs/`).

## Unchanged

- `CLAUDE.md` / `AGENTS.md` stay as they are (agent instructions, not README).
- Other docs files untouched.

## Edge cases

- Grep the repo for links/references to `README.md`; if any point at the
  technical sections, retarget them to `docs/DEVELOPMENT.md`.

## Success criteria

- README contains no code blocks, env vars, or npm commands.
- Every section of the old README exists in `docs/DEVELOPMENT.md` (no content
  loss).
- All relative links in both files resolve.

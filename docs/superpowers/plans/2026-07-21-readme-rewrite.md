# Product-First README Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the developer-oriented `README.md` with a non-technical, product-first README and move all technical content, without loss, into a new `docs/DEVELOPMENT.md`.

**Architecture:** Two-file docs change. `docs/DEVELOPMENT.md` is created first (so the README's link resolves at every commit), then `README.md` is fully rewritten. No code changes.

**Tech Stack:** Markdown only. Verification via `grep` and file-existence checks.

## Global Constraints

- Working directory is the **main-branch worktree**: `/private/tmp/claude-501/-Users-eren-Projects-maratus-admin/51bec67c-8ce9-4c2b-bab3-498999c62807/scratchpad/readme-main` — run every command there. Do NOT touch `/Users/eren/Projects/maratus-admin` (another session is active there on `feat/pinned-qr`).
- The product name stays **Maratus** everywhere (rename decision deferred; see `docs/naming-candidates.md`).
- README must contain **zero** code blocks, env-var names, or npm commands.
- Every section of the old README must exist in `docs/DEVELOPMENT.md` (no content loss).
- Language: English.
- Spec: `docs/superpowers/specs/2026-07-21-readme-rewrite-design.md`.

---

### Task 1: Create `docs/DEVELOPMENT.md` with all technical content

**Files:**
- Create: `docs/DEVELOPMENT.md`
- Read (source): `README.md` (current version at commit `ff0531c`)

**Interfaces:**
- Produces: `docs/DEVELOPMENT.md` — the target of the README's "For developers" link written in Task 2.

- [ ] **Step 1: Create the file**

Create `docs/DEVELOPMENT.md` whose content is, in order:

1. This exact header block:

```markdown
# Maratus — Development Guide

> Looking for what Maratus *is*? See the product overview in the
> [README](../README.md). This guide covers setup, architecture, and
> internals for developers.

Multi-tenant admin console for **Maratus**, a digital-document SaaS. Stores install
printer devices that replace paper documents with a QR code customers scan. Maratus
no longer ingests or hosts document content — a caller triggers a device over the
API and passes a URL to content it hosts itself; the device renders that URL as a
QR. This repo is the admin console plus the device-facing trigger/command API —
backed by a real database, auth, object storage, and prepaid-credit billing.
```

2. Then the current `README.md` content **verbatim from the `## Stack` heading (line 10) through the end of the file** (sections: Stack, Setup, Environment, Seed accounts, Commands, Architecture, Device → trigger → QR flow, Factory registry & zero-touch provisioning, Customer lifecycle, Billing, Testing — including the emerald `--primary` blockquote), with exactly two link re-basings because the file now lives inside `docs/`:

- `[`docs/device-protocol.md`](docs/device-protocol.md)` → `[`device-protocol.md`](device-protocol.md)`
- `[`docs/runbooks/factory-registry-hijack-recovery.md`](docs/runbooks/factory-registry-hijack-recovery.md)` → `[`runbooks/factory-registry-hijack-recovery.md`](runbooks/factory-registry-hijack-recovery.md)`

No other edits to the moved text.

- [ ] **Step 2: Verify no content loss and links resolve**

Run (from the worktree root):

```bash
for h in "## Stack" "## Setup" "### Environment" "### Seed accounts" "## Commands" "## Architecture" "## Device → trigger → QR flow" "## Factory registry" "## Customer lifecycle" "## Billing" "## Testing" ; do grep -q "$h" docs/DEVELOPMENT.md && echo "OK $h" || echo "MISSING $h"; done
test -f docs/device-protocol.md && test -f docs/runbooks/factory-registry-hijack-recovery.md && echo "LINK TARGETS OK"
grep -c "docs/device-protocol.md" docs/DEVELOPMENT.md || true
```

Expected: `OK` for all 11 headings, `LINK TARGETS OK`, and the last grep prints `0` (no stale `docs/`-prefixed self-links; exit code 1 from grep -c is fine).

- [ ] **Step 3: Commit**

```bash
git add docs/DEVELOPMENT.md
git commit -m "docs: add DEVELOPMENT.md carrying all technical content from README"
```

---

### Task 2: Rewrite `README.md` product-first

**Files:**
- Modify: `README.md` (full replacement)

**Interfaces:**
- Consumes: `docs/DEVELOPMENT.md` from Task 1 (link target must exist).

- [ ] **Step 1: Replace README.md with exactly this content**

```markdown
# Maratus

**Maratus turns paper documents into scannable QR codes at the point of sale.**

## The problem

Stores hand out huge amounts of paper every day — receipts, warranty slips,
return forms, instructions. Customers lose them, staff reprint them, and the
paper itself is pure waste. The information was digital all along; printing it
was only ever a delivery problem.

## What Maratus does

Maratus replaces that piece of paper with a small touch-screen device that sits
on the counter. At the moment a store would have printed something, the device
shows a QR code instead. The customer points their phone camera at it and the
digital version opens instantly — nothing to install, nothing to type.

The content itself always stays with the business: Maratus never stores or even
sees what's behind the link. It simply tells the right device, at the right
moment, to display it. For businesses this means no customer data ever has to
leave their own systems.

## How it works

1. **Unbox.** A Maratus device arrives already registered to your store — each
   unit is tracked from the factory.
2. **Connect.** The installer joins it to the store Wi-Fi on the device's own
   screen. It recognizes itself and is ready — no codes to type, no accounts
   to create at the counter.
3. **Trigger.** When your point-of-sale or back-office system has something
   for the customer, it tells Maratus "show this link" — one simple request.
4. **Scan.** The QR code appears on the screen, the customer scans it, and the
   device returns to its branded idle screen.

## Who uses it

**Store chains** manage everything from a web panel: their stores, the devices
in each store, how the device screens look (logo, colors, layout), their team
members, and their credit balance.

**The Maratus operations team** has its own panel to look after customers, the
device fleet across all of them, the manufacturing inventory, and the software
that ships to devices.

## Pricing

Maratus uses prepaid credits. Each QR code successfully shown to a customer
costs one credit; if a display fails, nothing is charged. Store chains top up
their balance directly in the panel, and every new customer starts with a
credit grant to try the service.

## For developers

Setup, architecture, and API internals live in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). The device-facing protocol is
documented in [docs/device-protocol.md](docs/device-protocol.md).
```

- [ ] **Step 2: Verify the README is non-technical and links resolve**

Run (from the worktree root):

```bash
grep -nE '```|npm |DATABASE_URL|BETTER_AUTH|R2_|STRIPE_|Drizzle|Next\.js|Neon|Vercel' README.md ; echo "exit=$?"
test -f docs/DEVELOPMENT.md && test -f docs/device-protocol.md && echo "LINK TARGETS OK"
```

Expected: first grep prints nothing with `exit=1` (no code fences, commands, env vars, or stack names); `LINK TARGETS OK`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README as product-first overview; technical content now in docs/DEVELOPMENT.md"
```

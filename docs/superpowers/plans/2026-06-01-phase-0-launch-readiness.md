# Phase 0 — Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between "feature-complete" and "safe for real customers" — a real landing page, a hardened ingest endpoint, the project's first test suite, and the config/scaffolding for email verification, observability, backups, and deploy.

**Architecture:** Pure, IO-free helpers (`lib/rate-limit.ts`, payload validation) are extracted so they unit-test without a DB or R2 connection. The ingest route composes them. External-account work (Sentry, Resend, Vercel) is wired behind env vars so the app degrades gracefully when a secret is absent.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Better Auth, Drizzle/Neon, Cloudflare R2, **vitest** (new — test runner).

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `vitest.config.ts` | Test runner config (node env, no React) | Create |
| `lib/rate-limit.ts` | Pure in-memory sliding-window limiter | Create |
| `lib/rate-limit.test.ts` | Unit tests for the limiter | Create |
| `lib/ingest-validation.ts` | Pure payload-size / mime validation | Create |
| `lib/ingest-validation.test.ts` | Unit tests for validation | Create |
| `app/api/ingest/route.ts` | Compose limiter + validation into the handler | Modify |
| `app/page.tsx` | Real landing page (replaces boilerplate) | Replace |
| `lib/auth.ts` | Flip email verification, wire send hook | Modify |
| `lib/email.ts` | Resend-backed transactional sender (graceful no-op) | Create |
| `lib/env.ts` | Add optional `RESEND_API_KEY`, `SENTRY_DSN` | Modify |
| `docs/runbooks/backup-restore.md` | Backup/restore runbook | Create |

> **Credential-dependent tasks** (5–8) are wired to be safe when secrets are absent. They cannot be fully *verified* in this session without accounts; each notes what's needed.

---

## Task 1: Test framework (vitest)

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (devDeps + `test` script)

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest@^3
```

- [ ] **Step 2: Create the config**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add the test script** to `package.json` `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify it runs (no tests yet = exit 0 with "no test files")**

Run: `npm test`
Expected: exits cleanly (no test files found is acceptable at this point).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "test: add vitest runner"
```

---

## Task 2: Rate limiter (pure helper, TDD)

A sliding-window counter keyed by an arbitrary string (device key hash). In-memory
Map — **note:** per-instance only; on multi-instance serverless this is a soft
first cut. Swap the store for Upstash/Redis in Phase 1 if abuse appears. The
interface stays the same.

**Files:**
- Create: `lib/rate-limit.ts`, `lib/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/rate-limit.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, __resetRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => __resetRateLimit());

  it("allows up to the limit within the window", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("k", { limit: 5, windowMs: 1000, now: 0 }).allowed).toBe(true);
    }
  });

  it("blocks the request over the limit and reports retryAfter", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("k", { limit: 5, windowMs: 1000, now: 0 });
    const sixth = checkRateLimit("k", { limit: 5, windowMs: 1000, now: 100 });
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterMs).toBe(900);
  });

  it("isolates separate keys", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("a", { limit: 5, windowMs: 1000, now: 0 });
    expect(checkRateLimit("b", { limit: 5, windowMs: 1000, now: 0 }).allowed).toBe(true);
  });

  it("frees capacity after the window slides past old hits", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("k", { limit: 5, windowMs: 1000, now: 0 });
    expect(checkRateLimit("k", { limit: 5, windowMs: 1000, now: 1001 }).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npm test -- lib/rate-limit.test.ts`
Expected: FAIL ("Cannot find module './rate-limit'").

- [ ] **Step 3: Implement the limiter**

```ts
// lib/rate-limit.ts
// In-memory sliding-window rate limiter. Per-process only — adequate as a first
// abuse cut; replace the `hits` store with Redis/Upstash for multi-instance.

type Opts = { limit: number; windowMs: number; now?: number };
type Result = { allowed: boolean; retryAfterMs: number };

const hits = new Map<string, number[]>();

export function checkRateLimit(key: string, opts: Opts): Result {
  const now = opts.now ?? Date.now();
  const cutoff = now - opts.windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= opts.limit) {
    const retryAfterMs = recent[0] + opts.windowMs - now;
    hits.set(key, recent);
    return { allowed: false, retryAfterMs };
  }

  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, retryAfterMs: 0 };
}

/** Test-only: clear all counters. */
export function __resetRateLimit() {
  hits.clear();
}
```

- [ ] **Step 4: Run it — expect pass**

Run: `npm test -- lib/rate-limit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/rate-limit.ts lib/rate-limit.test.ts
git commit -m "feat: add in-memory sliding-window rate limiter"
```

---

## Task 3: Ingest payload validation (pure helper, TDD)

**Files:**
- Create: `lib/ingest-validation.ts`, `lib/ingest-validation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ingest-validation.test.ts
import { describe, it, expect } from "vitest";
import { validateReceiptPayload, MAX_RECEIPT_BYTES } from "./ingest-validation";

describe("validateReceiptPayload", () => {
  it("accepts a normal-sized image/png", () => {
    expect(validateReceiptPayload(1024, "image/png")).toEqual({ ok: true });
  });

  it("rejects an empty payload", () => {
    expect(validateReceiptPayload(0, "image/png")).toEqual({
      ok: false,
      status: 400,
      error: "Empty receipt payload",
    });
  });

  it("rejects an over-size payload", () => {
    const res = validateReceiptPayload(MAX_RECEIPT_BYTES + 1, "image/png");
    expect(res).toEqual({ ok: false, status: 413, error: "Receipt image too large" });
  });

  it("rejects a non-image mime type", () => {
    const res = validateReceiptPayload(1024, "application/pdf");
    expect(res).toEqual({ ok: false, status: 415, error: "Unsupported media type" });
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npm test -- lib/ingest-validation.test.ts`
Expected: FAIL ("Cannot find module './ingest-validation'").

- [ ] **Step 3: Implement the validator**

```ts
// lib/ingest-validation.ts
// Pure validation for the ingest payload — size + mime guardrails.

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5 MB

type Ok = { ok: true };
type Err = { ok: false; status: number; error: string };

export function validateReceiptPayload(byteLength: number, mimeType: string): Ok | Err {
  if (byteLength === 0) return { ok: false, status: 400, error: "Empty receipt payload" };
  if (byteLength > MAX_RECEIPT_BYTES)
    return { ok: false, status: 413, error: "Receipt image too large" };
  if (!mimeType.startsWith("image/"))
    return { ok: false, status: 415, error: "Unsupported media type" };
  return { ok: true };
}
```

- [ ] **Step 4: Run it — expect pass**

Run: `npm test -- lib/ingest-validation.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ingest-validation.ts lib/ingest-validation.test.ts
git commit -m "feat: add ingest payload size/mime validation"
```

---

## Task 4: Wire limiter + validation into the ingest route

**Files:**
- Modify: `app/api/ingest/route.ts`

- [ ] **Step 1: Add imports** near the existing imports:

```ts
import { checkRateLimit } from "@/lib/rate-limit";
import { validateReceiptPayload } from "@/lib/ingest-validation";
```

- [ ] **Step 2: Rate-limit right after the device is authenticated** — insert immediately after the `if (device.status === "paused") return bad(403, "Device is paused");` line:

```ts
  // Throttle per device: 30 receipts / minute is generous for a kiosk.
  const rl = checkRateLimit(keyHash, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
```

- [ ] **Step 3: Replace the empty-payload check** — find `if (bytes.byteLength === 0) return bad(400, "Empty receipt payload");` and replace with:

```ts
  const payloadCheck = validateReceiptPayload(bytes.byteLength, mimeType);
  if (!payloadCheck.ok) return bad(payloadCheck.status, payloadCheck.error);
```

- [ ] **Step 4: Verify the project still type-checks and builds**

Run: `npx tsc --noEmit && npm run lint`
Expected: no type errors, lint clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/ingest/route.ts
git commit -m "feat: rate-limit and size-cap the ingest endpoint"
```

---

## Task 5: Real landing page

Replace the create-next-app boilerplate. Authenticated users get redirected to
their dashboard by role; everyone else sees a real hero with login/signup CTAs.

**Files:**
- Replace: `app/page.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/session";
import { Button } from "@/components/ui/button";

export default async function Home() {
  // Send signed-in users straight to their workspace.
  const ctx = await getContext();
  if (ctx?.user) {
    redirect(ctx.user.role === "platform_admin" ? "/admin" : "/tenant");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Paper receipts, gone.
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Maratus turns every checkout into a QR code your customers scan for an
          instant digital receipt. Manage your stores, devices, and billing from
          one console.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link href="/signup">Start free</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify `getContext` returns a nullable user** — confirm `lib/session.ts` exports `getContext` and that `ctx?.user?.role` is the right shape. If the signature differs, adjust the guard to match (the redirect target is `/admin` for `platform_admin`, else `/tenant`).

Run: `grep -nE "export .*getContext|role" lib/session.ts`

- [ ] **Step 3: Verify build + manual check**

Run: `npx tsc --noEmit`
Expected: no type errors. Then `npm run dev`, open `/` logged-out → hero with CTAs; logged-in → redirect to dashboard.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: real landing page replacing boilerplate"
```

---

## Task 6: Email verification + transactional email _(needs `RESEND_API_KEY`)_

Flip the verification gate on and provide a sender. Without the key, the sender
logs instead of throwing, so dev/seed flows keep working.

**Files:**
- Modify: `lib/env.ts` (add optional `RESEND_API_KEY`)
- Create: `lib/email.ts`
- Modify: `lib/auth.ts`

- [ ] **Step 1: Add the optional env var** to the `envSchema` object in `lib/env.ts`:

```ts
  // Transactional email (Resend). Optional: absent → emails are logged, not sent.
  RESEND_API_KEY: z.string().optional(),
```

- [ ] **Step 2: Create the sender**

```ts
// lib/email.ts
// Thin transactional-email wrapper. No-ops (logs) when RESEND_API_KEY is unset
// so local/seed flows don't break.

import { getEnv } from "./env";

export async function sendEmail(to: string, subject: string, html: string) {
  const key = getEnv().RESEND_API_KEY;
  if (!key) {
    console.warn(`[email] RESEND_API_KEY unset — would send "${subject}" to ${to}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Maratus <noreply@maratus.app>", to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
}
```

- [ ] **Step 3: Wire verification in `lib/auth.ts`** — set the gate and add the email hook. Replace the `emailAndPassword` block:

```ts
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail(
        user.email,
        "Verify your Maratus account",
        `<p>Welcome to Maratus. Confirm your email:</p><p><a href="${url}">Verify</a></p>`,
      );
    },
  },
```

Add the import at top: `import { sendEmail } from "./email";`

> **Verify against Better Auth 1.6 docs** before finalizing the `emailVerification` shape: `node_modules/better-auth/dist/...` or context7. Field names (`sendOnSignUp`, `sendVerificationEmail`) must match the installed version.

- [ ] **Step 4: Seed-account note** — existing seeded users have no `emailVerified` flag. Either set `emailVerified: true` in `lib/db/seed.ts` for seeded users, or they won't be able to sign in once the gate is on. Update the seed insert accordingly.

- [ ] **Step 5: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/env.ts lib/email.ts lib/auth.ts lib/db/seed.ts
git commit -m "feat: gate signups behind email verification via Resend"
```

---

## Task 7: Observability scaffold (Sentry) _(needs Sentry project + DSN)_

- [ ] **Step 1:** `npx @sentry/wizard@latest -i nextjs` (or install `@sentry/nextjs` and add `sentry.server.config.ts` / `instrumentation.ts` manually).
- [ ] **Step 2:** Add `SENTRY_DSN: z.string().optional()` to `lib/env.ts`; init only when present so local dev stays quiet.
- [ ] **Step 3:** Wrap the ingest route, public receipt route, and server actions' catch blocks with `Sentry.captureException`.
- [ ] **Step 4:** Add structured `console.*`/logger lines on ingest, claim, and receipt-download paths.
- [ ] **Step 5:** Commit `feat: add Sentry error tracking + structured logs`.

> Blocked on a Sentry account + DSN. Wiring is safe without it (init guarded by env).

---

## Task 8: Backup/restore runbook + deploy config _(needs Neon/R2/Vercel access)_

- [ ] **Step 1:** Create `docs/runbooks/backup-restore.md` documenting: Neon PITR settings, target RPO/RTO, the step-by-step restore procedure, and R2 versioning/lifecycle status. A runbook is only done when the restore has been *tested once*.
- [ ] **Step 2:** Verify `serverExternalPackages` and the `--webpack` build flag survive the deploy pipeline (both have silently reverted before — see project memory).
- [ ] **Step 3:** Add a `/api/health` route returning `{ ok: true }` (200) for uptime checks.
- [ ] **Step 4:** Configure the Vercel project: set all env vars from `lib/env.ts`, deploy a preview, smoke-test, promote.
- [ ] **Step 5:** Commit `chore: add health check + backup/restore runbook`.

> Blocked on infra access (Neon console, R2, Vercel account).

---

## Self-Review

- **Spec coverage:** landing page (T5), ingest hardening (T2–4), email verification (T6), observability (T7), backup/restore (T8), smoke tests (T1–3 establish the harness + first real tests), deploy config (T8). All seven Phase 0 items mapped.
- **Placeholder scan:** none — every code step has real code. Credential-blocked tasks (7, 8) are intentionally checklist-style because their content depends on account specifics; they are flagged, not vague.
- **Type consistency:** `checkRateLimit` / `validateReceiptPayload` / `sendEmail` signatures match between their defining task and their use in the ingest route and auth config.

## Execution order note

Tasks **1–5 are fully executable in-session** (pure code + config, tests run green with no DB/R2/account). Tasks **6–8 need secrets/accounts** and should be done once those are provisioned; their code is written to degrade gracefully when the secret is absent.

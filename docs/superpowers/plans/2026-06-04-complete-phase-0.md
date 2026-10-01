# Complete Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two remaining Phase 0 leftovers — Sentry error tracking and real email-verification UX — wired to activate automatically when their env keys are present and to preserve current dev/seed behavior when absent.

**Architecture:** Sentry uses approach B (manual, init-only `@sentry/nextjs` — no `withSentryConfig`, no build-pipeline changes). It initializes only when `SENTRY_DSN` (server/edge) / `NEXT_PUBLIC_SENTRY_DSN` (browser) are set; `onRequestError` auto-captures thrown errors, and explicit `reportError` covers the ingest route's swallowed best-effort catches. Email verification becomes conditional on `RESEND_API_KEY`: when set, self-serve company signup no longer auto-verifies — it routes to a "check your email" screen; when unset, behavior is byte-for-byte unchanged. Invite signup always auto-verifies (the invitation email already proves inbox ownership).

**Tech Stack:** Next.js 16 (App Router, `instrumentation.ts`), `@sentry/nextjs`, Better Auth, Drizzle, vitest (pure `lib/**/*.test.ts` logic tests).

---

## File Structure

**Sentry**
- Create `lib/observability.ts` — pure `sentryInitOptions()` (testable) + `reportError()` glue.
- Create `lib/observability.test.ts` — unit tests for `sentryInitOptions`.
- Create `sentry.server.config.ts`, `sentry.edge.config.ts` (repo root) — runtime `Sentry.init`.
- Create `instrumentation.ts`, `instrumentation-client.ts` (repo root) — Next hooks.
- Modify `lib/env.ts`, `.env.example` — three optional Sentry vars.
- Modify `app/api/ingest/route.ts` — `reportError` on swallowed catches.

**Email verification**
- Create `lib/email-verification.ts` — pure `emailVerificationEnabled()`.
- Create `lib/email-verification.test.ts` — unit tests.
- Create `app/(auth)/verify-email/page.tsx` + `app/(auth)/verify-email/verify-email-notice.tsx`.
- Modify `lib/actions/register.ts` — gate the auto-verify branch; extend `RegisterResult`.
- Modify `app/(auth)/signup/signup-form.tsx` — route to the pending screen.

---

## Part A — Sentry observability

### Task 1: Install SDK and add env vars

**Files:**
- Modify: `package.json` (via npm)
- Modify: `lib/env.ts:8-32`
- Modify: `.env.example`

- [ ] **Step 1: Install the SDK**

Run:
```bash
npm install @sentry/nextjs
```
Expected: `@sentry/nextjs` added to `dependencies`, install succeeds.

- [ ] **Step 2: Add the three optional Sentry vars to the env schema**

In `lib/env.ts`, inside the `z.object({ ... })` (after the `RESEND_API_KEY` line), add:

```ts
  // Error tracking (Sentry). All optional: absent → the SDK is never
  // initialized (no-ops). NEXT_PUBLIC_ is required for the browser DSN.
  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default("development"),
```

- [ ] **Step 3: Document them in `.env.example`**

Append to `.env.example`:

```bash
# Error tracking (Sentry) — optional. Absent → error tracking is inert.
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_ENVIRONMENT=development
```

- [ ] **Step 4: Verify env still parses**

Run:
```bash
npx tsc --noEmit
```
Expected: no new type errors from `lib/env.ts`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/env.ts .env.example
git commit -m "feat(observability): add @sentry/nextjs dep and Sentry env vars"
```

---

### Task 2: Pure observability helper (TDD)

**Files:**
- Create: `lib/observability.ts`
- Test: `lib/observability.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/observability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sentryInitOptions } from "./observability";

describe("sentryInitOptions", () => {
  it("returns null when no DSN is provided", () => {
    expect(sentryInitOptions({ dsn: undefined, environment: "production" })).toBeNull();
    expect(sentryInitOptions({ dsn: "", environment: "production" })).toBeNull();
  });

  it("returns errors-only init options when a DSN is provided", () => {
    const opts = sentryInitOptions({ dsn: "https://abc@o1.ingest.sentry.io/1", environment: "production" });
    expect(opts).toEqual({
      dsn: "https://abc@o1.ingest.sentry.io/1",
      environment: "production",
      tracesSampleRate: 0,
    });
  });

  it("defaults environment to development when omitted", () => {
    const opts = sentryInitOptions({ dsn: "https://abc@o1.ingest.sentry.io/1" });
    expect(opts?.environment).toBe("development");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/observability.test.ts`
Expected: FAIL — `Cannot find module './observability'`.

- [ ] **Step 3: Write the implementation**

Create `lib/observability.ts`:

```ts
// Observability helpers (Sentry, approach B — manual, init-only).
//
// `sentryInitOptions` is a pure function so it can be unit-tested and reused by
// the server, edge, and client init paths. It returns null when no DSN is set,
// which the callers use to skip `Sentry.init` entirely (the SDK then no-ops).
//
// `reportError` is thin glue over `Sentry.captureException` for the few places
// that SWALLOW errors (catch + log, never rethrow) — those never reach Next's
// `onRequestError` hook, so we report them explicitly.

import * as Sentry from "@sentry/nextjs";

export interface SentryInitOptions {
  dsn: string;
  environment: string;
  /** Errors only — no performance tracing (approach B). */
  tracesSampleRate: number;
}

export function sentryInitOptions(input: {
  dsn?: string;
  environment?: string;
}): SentryInitOptions | null {
  if (!input.dsn) return null;
  return {
    dsn: input.dsn,
    environment: input.environment ?? "development",
    tracesSampleRate: 0,
  };
}

/**
 * Report a swallowed error to Sentry. No-ops automatically when Sentry was never
 * initialized (no DSN). Never include secrets in `extra` — no device keys, no
 * receipt tokens.
 */
export function reportError(
  error: unknown,
  context: { path: string; extra?: Record<string, unknown> },
): void {
  Sentry.captureException(error, {
    tags: { path: context.path },
    extra: context.extra,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/observability.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/observability.ts lib/observability.test.ts
git commit -m "feat(observability): pure sentryInitOptions helper + reportError glue"
```

---

### Task 3: Sentry runtime configs + Next instrumentation hooks

**Files:**
- Create: `sentry.server.config.ts`
- Create: `sentry.edge.config.ts`
- Create: `instrumentation.ts`
- Create: `instrumentation-client.ts`

- [ ] **Step 1: Create the server config**

Create `sentry.server.config.ts` (repo root):

```ts
// Node.js runtime Sentry init. Loaded by instrumentation.ts `register()`.
import * as Sentry from "@sentry/nextjs";
import { getEnv } from "@/lib/env";
import { sentryInitOptions } from "@/lib/observability";

const env = getEnv();
const opts = sentryInitOptions({ dsn: env.SENTRY_DSN, environment: env.SENTRY_ENVIRONMENT });
if (opts) Sentry.init(opts);
```

- [ ] **Step 2: Create the edge config**

Create `sentry.edge.config.ts` (repo root):

```ts
// Edge runtime Sentry init. Loaded by instrumentation.ts `register()`.
import * as Sentry from "@sentry/nextjs";
import { sentryInitOptions } from "@/lib/observability";

const opts = sentryInitOptions({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT,
});
if (opts) Sentry.init(opts);
```

> Note: the edge config reads `process.env` directly (not `getEnv()`), because the
> zod env loader is server-only and the edge runtime lacks the full Node env.

- [ ] **Step 3: Create the instrumentation entrypoint**

Create `instrumentation.ts` (repo root):

```ts
// Next.js instrumentation. `register()` runs once per server instance and loads
// the runtime-appropriate Sentry config. `onRequestError` forwards every server
// error Next surfaces (routes, server actions, RSC render) to Sentry.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
```

- [ ] **Step 4: Create the client instrumentation**

Create `instrumentation-client.ts` (repo root):

```ts
// Browser-side Sentry init (captures unhandled errors in the dashboard React
// app). Inert unless NEXT_PUBLIC_SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";
import { sentryInitOptions } from "@/lib/observability";

const opts = sentryInitOptions({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.SENTRY_ENVIRONMENT,
});
if (opts) Sentry.init(opts);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Build smoke test (the key risk for approach B)**

Run: `npm run build`
Expected: build SUCCEEDS. The new instrumentation files must not break the
`next build --webpack` pipeline or `serverExternalPackages`. If the build fails
with a bundling error mentioning `@sentry/nextjs` or `import-in-the-middle`,
STOP and add `@sentry/nextjs` to `serverExternalPackages` in `next.config.ts`,
then re-run — do not make any other build-config change.

- [ ] **Step 7: Commit**

```bash
git add instrumentation.ts instrumentation-client.ts sentry.server.config.ts sentry.edge.config.ts
git commit -m "feat(observability): Sentry instrumentation hooks + runtime configs (inert without DSN)"
```

---

### Task 4: Report swallowed errors on the ingest critical path

**Files:**
- Modify: `app/api/ingest/route.ts`

> Rationale: `onRequestError` already auto-captures thrown errors (claim, receipt
> render, server actions). Only the ingest route SWALLOWS errors — those need
> explicit `reportError`. Never pass the device bearer key; `device.id`/`orgId`
> are safe.

- [ ] **Step 1: Import the helper**

In `app/api/ingest/route.ts`, add to the import block (after the `validateReceiptPayload` import):

```ts
import { reportError } from "@/lib/observability";
```

- [ ] **Step 2: Report the swallowed suspension-check error**

Replace:

```ts
  } catch (err) {
    console.error("[ingest] suspension check failed (allowing)", err);
  }
```

with:

```ts
  } catch (err) {
    console.error("[ingest] suspension check failed (allowing)", err);
    reportError(err, { path: "ingest.suspension-check", extra: { orgId: device.organizationId, deviceId: device.id } });
  }
```

- [ ] **Step 3: Report the swallowed R2 upload error**

Replace:

```ts
  } catch (err) {
    console.error("R2 upload failed", err);
    return bad(502, "Storage upload failed");
  }
```

with:

```ts
  } catch (err) {
    console.error("R2 upload failed", err);
    reportError(err, { path: "ingest.r2-upload", extra: { orgId: device.organizationId, deviceId: device.id, receiptId } });
    return bad(502, "Storage upload failed");
  }
```

- [ ] **Step 4: Report the swallowed meter-event error**

Replace:

```ts
      reportReceiptUsage(settings.customerId).catch((e) =>
        console.error("[ingest] meter event failed", e),
      );
```

with:

```ts
      reportReceiptUsage(settings.customerId).catch((e) => {
        console.error("[ingest] meter event failed", e);
        reportError(e, { path: "ingest.meter-event", extra: { orgId: device.organizationId } });
      });
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/ingest/route.ts
git commit -m "feat(observability): report swallowed ingest errors to Sentry"
```

---

## Part B — Email verification

### Task 5: Pure email-verification gate (TDD)

**Files:**
- Create: `lib/email-verification.ts`
- Test: `lib/email-verification.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/email-verification.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { emailVerificationEnabled } from "./email-verification";

describe("emailVerificationEnabled", () => {
  it("is enabled only when a Resend API key is present", () => {
    expect(emailVerificationEnabled("re_live_xxx")).toBe(true);
  });
  it("is disabled when the key is missing or empty", () => {
    expect(emailVerificationEnabled(undefined)).toBe(false);
    expect(emailVerificationEnabled("")).toBe(false);
    expect(emailVerificationEnabled("   ")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/email-verification.test.ts`
Expected: FAIL — `Cannot find module './email-verification'`.

- [ ] **Step 3: Write the implementation**

Create `lib/email-verification.ts`:

```ts
// Email-verification gate. Real "check your email" verification is only enforced
// when transactional email can actually be delivered — i.e. when RESEND_API_KEY
// is configured. Without it, signup flows auto-verify (see lib/actions/register.ts)
// so local/seed/dev users still land in the dashboard.
//
// Pure (IO-free): the caller passes the key (e.g. getEnv().RESEND_API_KEY).
export function emailVerificationEnabled(resendApiKey: string | undefined): boolean {
  return Boolean(resendApiKey && resendApiKey.trim().length > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/email-verification.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/email-verification.ts lib/email-verification.test.ts
git commit -m "feat(auth): pure emailVerificationEnabled gate helper"
```

---

### Task 6: Gate the company-signup auto-verify branch

**Files:**
- Modify: `lib/actions/register.ts`

- [ ] **Step 1: Extend the result type and add imports**

In `lib/actions/register.ts`, change the imports to add the gate + env, after the `recordAudit` import:

```ts
import { emailVerificationEnabled } from "@/lib/email-verification";
import { getEnv } from "@/lib/env";
```

Then change the `RegisterResult` interface:

```ts
export interface RegisterResult {
  ok: boolean;
  error?: string;
  /** True when the account was created but must verify its email before sign-in. */
  pendingVerification?: boolean;
  /** Echoed back so the client can show "we emailed {email}". */
  email?: string;
}
```

- [ ] **Step 2: Branch the final verify+sign-in step on the gate**

Replace the current step 5 block (the comment beginning "5. The company creator owns this email" through the `auth.api.signInEmail` try/catch), i.e. replace:

```ts
  // 5. The company creator owns this email (they're standing up their own org),
  // so mark them verified and sign them in — establishing the session cookie via
  // nextCookies — so the client redirect to /tenant lands them in the dashboard
  // instead of bouncing to /login.
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
  try {
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not sign in." };
  }

  await recordAudit({
    organizationId: orgId,
    actor: { type: "user", id: userId, label: email },
    action: AUDIT.orgCreated,
    metadata: { name: companyName },
  });

  return { ok: true };
```

with:

```ts
  await recordAudit({
    organizationId: orgId,
    actor: { type: "user", id: userId, label: email },
    action: AUDIT.orgCreated,
    metadata: { name: companyName },
  });

  // 5. Finish based on whether real email verification is active.
  if (emailVerificationEnabled(getEnv().RESEND_API_KEY)) {
    // Verification email already dispatched by Better Auth (sendOnSignUp). Leave
    // the user unverified + unsigned-in; the client routes to "check your email".
    // The org + membership already exist, so verifying later drops them straight in.
    return { ok: true, pendingVerification: true, email };
  }

  // No email delivery configured → the creator owns this email anyway, so verify
  // and sign them in (session cookie via nextCookies) so /tenant doesn't bounce.
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
  try {
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not sign in." };
  }

  return { ok: true };
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/register.ts
git commit -m "feat(auth): gate company-signup auto-verify on RESEND_API_KEY"
```

---

### Task 7: "Check your email" screen

**Files:**
- Create: `app/(auth)/verify-email/verify-email-notice.tsx`
- Create: `app/(auth)/verify-email/page.tsx`

- [ ] **Step 1: Create the client notice component**

Create `app/(auth)/verify-email/verify-email-notice.tsx`:

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { MailCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MaratusWordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { authClient } from "@/lib/auth-client";

export function VerifyEmailNotice({ email }: { email?: string }) {
  const [sending, setSending] = React.useState(false);

  async function resend() {
    if (!email) return;
    setSending(true);
    try {
      await authClient.sendVerificationEmail({ email, callbackURL: "/tenant" });
      toast.success("Verification email sent", { description: `We re-sent the link to ${email}.` });
    } catch {
      toast.error("Couldn't resend", { description: "Please try again in a moment." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-svh flex-col px-6 py-8 sm:px-12">
      <div className="flex items-center justify-between">
        <MaratusWordmark />
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-sm space-y-6 py-10 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MailCheck className="size-6" />
          </span>
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-bold tracking-tight">Check your email</h1>
            <p className="text-sm text-muted-foreground">
              {email ? <>We sent a verification link to <span className="font-medium text-foreground">{email}</span>.</> : "We sent you a verification link."}{" "}
              Click it to finish setting up your workspace.
            </p>
          </div>
          <Button onClick={resend} variant="outline" className="w-full" disabled={sending || !email}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : "Resend email"}
          </Button>
          <p className="text-sm text-muted-foreground">
            Already verified?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the page (reads `email` from the query string)**

Create `app/(auth)/verify-email/page.tsx`:

```tsx
import { VerifyEmailNotice } from "./verify-email-notice";

// Shown after self-serve signup when email verification is active.
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  return <VerifyEmailNotice email={email} />;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(auth)/verify-email"
git commit -m "feat(auth): check-your-email verification screen with resend"
```

---

### Task 8: Route the signup form to the pending screen

**Files:**
- Modify: `app/(auth)/signup/signup-form.tsx:24-35`

- [ ] **Step 1: Handle `pendingVerification` after a successful submit**

In `app/(auth)/signup/signup-form.tsx`, replace the success branch of `handleSubmit`:

```tsx
    if (!res.ok) {
      toast.error("Couldn't create your account", { description: res.error });
      return;
    }
    toast.success("Welcome to Maratus", {
      description: "Your workspace is ready.",
    });
    router.push("/tenant");
    router.refresh();
```

with:

```tsx
    if (!res.ok) {
      toast.error("Couldn't create your account", { description: res.error });
      return;
    }
    if (res.pendingVerification) {
      router.push(`/verify-email?email=${encodeURIComponent(res.email ?? "")}`);
      return;
    }
    toast.success("Welcome to Maratus", {
      description: "Your workspace is ready.",
    });
    router.push("/tenant");
    router.refresh();
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(auth)/signup/signup-form.tsx"
git commit -m "feat(auth): route signup to check-your-email when verification is active"
```

---

### Task 9: Full verification (tests + build)

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS — all existing suites plus the two new ones (`observability`, `email-verification`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build SUCCEEDS with all new files present.

- [ ] **Step 4: Confirm dev/seed behavior is preserved (no keys)**

With no `RESEND_API_KEY` and no `SENTRY_DSN` in `.env.local`, reason through:
- `emailVerificationEnabled(undefined)` → `false` → company signup still auto-verifies + signs in (unchanged).
- `sentryInitOptions({dsn: undefined})` → `null` → `Sentry.init` skipped → SDK no-ops.

Run (sanity that seed still works):
```bash
npm run db:seed
```
Expected: completes; seeded users remain sign-in-capable.

- [ ] **Step 5: Final commit (if any uncommitted changes remain)**

```bash
git status
# only if there are stragglers:
git add -A && git commit -m "chore: complete Phase 0 (observability + email verification)"
```

---

## Self-Review Notes

- **Spec coverage:** Sentry approach B (init-only, no `withSentryConfig`) → Tasks 1–4; email verification gated on Resend key with "check your email" UX, invite path unchanged → Tasks 5–8; pure-helper unit tests matching codebase convention → Tasks 2 & 5; build smoke test (the approach-B risk) → Tasks 3 & 9.
- **Deviation from spec (intentional, tighter):** `acceptInviteSignup` is left auto-verify always — the invitation email already proves inbox ownership, so a second verification email would be redundant friction. Only `registerCompany` is gated. Spec Part 2 updated to match.
- **Out of scope (unchanged):** password reset, Sentry source-map upload, performance tracing.

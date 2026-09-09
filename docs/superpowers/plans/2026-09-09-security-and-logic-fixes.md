# Security & Logic Fixes (audit 2026-09-09) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the High/Medium findings of the 2026-09-09 whole-codebase security audit and the High/Medium logic bugs found alongside it, without changing product behaviour beyond what each fix requires.

**Architecture:** Every fix is local to the module that owns the bug. Where a decision is pure (path safety, key prefix, expiry, notification), extract it into a small pure function with a vitest test, and keep the DB/IO wrapper thin — that is how the rest of `lib/` is built. No schema changes, no migrations.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Drizzle ORM over Neon, Better Auth 1.6.13 (organization plugin), vitest (`npm test`, tests live in `lib/**/*.test.ts`), sharp.

**Spec:** The audit report delivered in the session on 2026-09-09 (no separate spec file). The binding requirements are restated per task below.

## Global Constraints

- **Never run anything against the database.** vitest loads `.env.local`, which points at **PRODUCTION**. Do not run `npm run db:seed`, `db:push`, `db:migrate`, or any ad-hoc script that writes. Unit tests must only exercise pure functions; never add a test that opens a DB connection.
- Keep `https://*.vercel.app` in `computeTrustedOrigins` (`lib/trusted-origins.ts`). Preview deployments depend on it. The reset-token fix must work without removing it.
- Tenant roles: `canManageTenant(role)` in `lib/roles.ts` (owner/admin). Platform admin = `user.role === "platform_admin"`. Keep those gates exactly as they are.
- Money stays in integer cents. Proration months are integers.
- Prefer editing existing files over new ones. New pure helpers go next to their consumers with a sibling `*.test.ts`.
- Every task: run `npm test` (whole suite, ~3 s) and `npx tsc --noEmit` before committing. Both must be clean.
- Commit per task with a conventional message (`fix(auth): …`, `fix(billing): …`). Do not push.
- Do not touch the three items explicitly excluded from this batch: early-renewal slot shrink (`slotsAfterPayment` at renewal), `deviceCommand.deviceId` cascade → set-null migration, and the zero-touch auto-claim / PIN-hash change. They need a product decision.

---

### Task 1: Better Auth hardening (reset-token pin, org plugin flags, HTTP sign-up lock, invite email escaping)

**Files:**
- Create: `lib/auth-hooks.ts`, `lib/auth-hooks.test.ts`
- Modify: `lib/auth.ts` (hooks.before block, emailAndPassword, organization plugin options, sendInvitationEmail)
- Modify: `lib/actions/customers.ts:178-184` (escape org name in owner-invite email)
- Modify: `lib/actions/members.ts:132-142` (`acceptInviteSignup` existing-account check)

**Interfaces:**
- Produces: `pinAuthCallbacks(path: string, body: unknown): Record<string, unknown> | null` and `decideHttpSignUp(a: { isHttpRequest: boolean }): { ok: true } | { ok: false; reason: "http_signup_disabled" }` in `lib/auth-hooks.ts`.
- Consumes: `escapeHtml` from `lib/billing/invoice-emails.ts`; `checkSignUpGate` from `lib/signup-gate.ts`.

Background you need: Better Auth's `hooks.before` receives `ctx` with `ctx.path` (e.g. `/request-password-reset`), `ctx.body` (parsed JSON) and `ctx.request` — **`ctx.request` is set only when the endpoint was reached through the HTTP handler**; a server-side `auth.api.signUpEmail({ body, headers })` call has `ctx.request === undefined` (see `node_modules/better-auth/dist/plugins/organization/routes/crud-org.mjs:48`, which distinguishes the two the same way). Returning `{ context: { body } }` from a before-hook replaces the body the endpoint sees (`node_modules/better-auth/dist/api/to-auth-endpoints.mjs:74-89`).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/auth-hooks.test.ts
import { describe, expect, it } from "vitest";
import { decideHttpSignUp, pinAuthCallbacks } from "./auth-hooks";

describe("pinAuthCallbacks", () => {
  it("forces redirectTo on password-reset requests, whatever the caller sent", () => {
    expect(
      pinAuthCallbacks("/request-password-reset", { email: "a@b.co", redirectTo: "https://evil.vercel.app/x" }),
    ).toEqual({ email: "a@b.co", redirectTo: "/reset-password" });
  });
  it("forces callbackURL on verification-email requests", () => {
    expect(pinAuthCallbacks("/send-verification-email", { email: "a@b.co", callbackURL: "https://evil.vercel.app" }))
      .toEqual({ email: "a@b.co", callbackURL: "/tenant" });
  });
  it("forces callbackURL on sign-up (the verification mail it sends)", () => {
    expect(pinAuthCallbacks("/sign-up/email", { email: "a@b.co", name: "A", password: "x", callbackURL: "//evil" }))
      .toEqual({ email: "a@b.co", name: "A", password: "x", callbackURL: "/tenant" });
  });
  it("returns null for every other path", () => {
    expect(pinAuthCallbacks("/sign-in/email", { email: "a@b.co" })).toBeNull();
  });
  it("tolerates a missing body", () => {
    expect(pinAuthCallbacks("/request-password-reset", undefined)).toEqual({ redirectTo: "/reset-password" });
  });
});

describe("decideHttpSignUp", () => {
  it("blocks sign-up that arrived over HTTP", () => {
    expect(decideHttpSignUp({ isHttpRequest: true })).toEqual({ ok: false, reason: "http_signup_disabled" });
  });
  it("allows the server-side acceptInviteSignup call", () => {
    expect(decideHttpSignUp({ isHttpRequest: false })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/auth-hooks.test.ts`
Expected: FAIL — module `./auth-hooks` not found.

- [ ] **Step 3: Create `lib/auth-hooks.ts`**

```ts
// Pure decisions for the Better Auth `hooks.before` middleware in lib/auth.ts.
//
// pinAuthCallbacks: the reset/verification callback is a first-party page and
// must never be caller-controlled. Better Auth validates `redirectTo` /
// `callbackURL` only against trustedOrigins, and the wildcard we keep for
// Vercel previews (https://*.vercel.app) matches ANY vercel.app host — so the
// password-reset callback (which appends the raw token to the redirect) could
// be pointed at an attacker's deployment. Pinning the value server-side closes
// that without touching the origin list.
//
// decideHttpSignUp: accounts are created ONLY by acceptInviteSignup
// (lib/actions/members.ts), which proves possession of the emailed invitation
// id. The public POST /api/auth/sign-up/email must not create accounts —
// with only an email-level invitation check, anyone who knew an invitee's
// address could pre-register it with their own password.

const PINNED: Record<string, Record<string, string>> = {
  "/request-password-reset": { redirectTo: "/reset-password" },
  "/send-verification-email": { callbackURL: "/tenant" },
  "/sign-up/email": { callbackURL: "/tenant" },
};

export function pinAuthCallbacks(path: string, body: unknown): Record<string, unknown> | null {
  const pins = PINNED[path];
  if (!pins) return null;
  const base = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return { ...base, ...pins };
}

export type HttpSignUpDecision = { ok: true } | { ok: false; reason: "http_signup_disabled" };

export function decideHttpSignUp(a: { isHttpRequest: boolean }): HttpSignUpDecision {
  return a.isHttpRequest ? { ok: false, reason: "http_signup_disabled" } : { ok: true };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/auth-hooks.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Wire the hook, flags and escaping into `lib/auth.ts`**

Replace the `hooks.before` middleware body with:

```ts
    before: createAuthMiddleware(async (ctx) => {
      // Reset/verification callbacks are first-party pages; never trust the
      // caller's redirectTo/callbackURL (see lib/auth-hooks.ts).
      const pinned = pinAuthCallbacks(ctx.path, ctx.body);
      if (pinned) {
        if (ctx.path !== "/sign-up/email") return { context: { body: pinned } };
        // Sign-up: also apply the invite-only gates below, then pin.
      }
      if (ctx.path !== "/sign-up/email") return;

      const http = decideHttpSignUp({ isHttpRequest: ctx.request !== undefined });
      if (!http.ok) {
        throw new APIError("FORBIDDEN", {
          code: "SIGNUP_DISABLED",
          message: "Maratus accounts are invite-only. Use the link in your invitation email.",
        });
      }
      const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "");
      const decision = await checkSignUpGate(email);
      if (!decision.ok) {
        throw new APIError("FORBIDDEN", {
          code: "SIGNUP_DISABLED",
          message: "Maratus accounts are invite-only. Ask a workspace admin to invite you.",
        });
      }
      return { context: { body: pinned } };
    }),
```

Add the imports at the top of `lib/auth.ts`:

```ts
import { decideHttpSignUp, pinAuthCallbacks } from "./auth-hooks";
import { escapeHtml } from "./billing/invoice-emails";
```

In `emailAndPassword`, after `resetPasswordTokenExpiresIn: 3600,` add:

```ts
    // A password reset is how a user evicts whoever else holds their account;
    // every other session must die with it.
    revokeSessionsOnPasswordReset: true,
```

Change the organization plugin call to:

```ts
    organization({
      // Tenants are created by a platform admin (lib/actions/customers.ts) and
      // offboarded by a reversible archive — the plugin's own create/delete
      // routes must not be reachable by tenant users. Seeding still works:
      // auth.api.createOrganization with `userId` and no session is treated as
      // a system action by the plugin.
      allowUserToCreateOrganization: false,
      disableOrganizationDeletion: true,
      async sendInvitationEmail(data) {
        const url = `${env.BETTER_AUTH_URL}/signup?invite=${data.id}`;
        // Inviter name and org name are user-controlled → escape (an org admin
        // could otherwise put arbitrary HTML into a mail from noreply@maratus.co).
        const inviter = escapeHtml(data.inviter.user.name);
        const orgName = escapeHtml(data.organization.name);
        await sendEmail(
          data.email,
          `You're invited to ${data.organization.name.replace(/[\r\n]/g, " ")} on Maratus`,
          `<p>${inviter} invited you to join <b>${orgName}</b> on Maratus.</p>` +
            `<p><a href="${url}">Accept the invitation</a></p>`,
        );
      },
    }),
```

- [ ] **Step 6: Escape the owner-invite email in `lib/actions/customers.ts`**

Add `import { escapeHtml } from "@/lib/billing/invoice-emails";` and change the `sendEmail` call at lines ~178-184 to:

```ts
  const emailed = await sendEmail(
    email,
    `You're invited to own ${org.name.replace(/[\r\n]/g, " ")} on Maratus`,
    `<p>The Maratus team invited you to own ` +
      `<b>${escapeHtml(org.name)}</b> on Maratus.</p>` +
      `<p><a href="${url}">Accept the invitation</a></p>`,
  );
```

- [ ] **Step 7: Fix the dead "already exists" branch in `acceptInviteSignup` (`lib/actions/members.ts`)**

With `requireEmailVerification` on, `auth.api.signUpEmail` for an existing email does NOT throw — it returns a synthetic user — so the current catch never fires and the code then flips `emailVerified = true` on a pre-existing account. Insert this check right after the password-length check and before the `try { await auth.api.signUpEmail(...)`:

```ts
  // signUpEmail does not throw for an existing email while
  // requireEmailVerification is on (it returns a synthetic user), so check
  // first — otherwise we would mark someone else's account verified below.
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${inv.email.toLowerCase()}`)
    .limit(1);
  if (existing) return { ok: false, error: "An account with that email already exists — sign in to accept." };
```

Make sure `sql` is imported from `drizzle-orm` in that file (add to the existing import if missing).

- [ ] **Step 8: Type-check and run the whole suite**

Run: `npx tsc --noEmit && npm test`
Expected: both clean (existing 554 + 7 new).

- [ ] **Step 9: Commit**

```bash
git add lib/auth.ts lib/auth-hooks.ts lib/auth-hooks.test.ts lib/actions/customers.ts lib/actions/members.ts
git commit -m "fix(auth): pin reset/verify callbacks, lock HTTP sign-up, disable org create/delete, escape invite emails"
```

---

### Task 2: Scope branding image keys to the tenant's own R2 prefix

**Files:**
- Create: `lib/asset-keys.ts`, `lib/asset-keys.test.ts`
- Modify: `app/(tenant)/tenant/branding/actions.ts` (validation after normalize; previousImageKeys and orphan filter)
- Modify: `lib/data.ts` `getTenantBranding` (~1478-1495) and `getDeviceConfig` (~1628-1645) presign loops

**Interfaces:**
- Produces: `isTenantImageKey(organizationId: string, key: string): boolean` in `lib/asset-keys.ts`.
- Consumes: `imageStorageKey` shape `branding/${organizationId}/images/${assetId}` (`lib/storage.ts:96-101`), `isDirectAssetUrl` (`lib/data.ts:1423`).

Background: `sanitizeImage` (`lib/printer-layout.ts:429-433`) keeps any string as `image.url`; `saveBranding` persists non-`pending:` URLs verbatim, later presigns them for the browser and deletes "orphaned" previous keys with `deleteObject(k)` — no prefix check. A tenant owner can therefore presign-download and then delete any bucket object (e.g. `firmware/0.19.1/ditto-firmware.bin`). Do not import `lib/storage.ts` into the new helper (it builds an S3 client at module load).

- [ ] **Step 1: Write the failing test**

```ts
// lib/asset-keys.test.ts
import { describe, expect, it } from "vitest";
import { isTenantImageKey } from "./asset-keys";

describe("isTenantImageKey", () => {
  const org = "org_abc";
  it("accepts a key under the org's images prefix", () => {
    expect(isTenantImageKey(org, "branding/org_abc/images/image_x1")).toBe(true);
  });
  it("rejects another org's prefix", () => {
    expect(isTenantImageKey(org, "branding/org_zzz/images/image_x1")).toBe(false);
  });
  it("rejects firmware and other bucket paths", () => {
    expect(isTenantImageKey(org, "firmware/0.19.1/ditto-firmware.bin")).toBe(false);
    expect(isTenantImageKey(org, "logos/org_abc/l1")).toBe(false);
  });
  it("rejects traversal, empty segments and a bare prefix", () => {
    expect(isTenantImageKey(org, "branding/org_abc/images/../../x")).toBe(false);
    expect(isTenantImageKey(org, "branding/org_abc/images/")).toBe(false);
    expect(isTenantImageKey(org, "branding/org_abc/images/a/b")).toBe(false);
  });
  it("rejects direct URLs (those are never R2 keys)", () => {
    expect(isTenantImageKey(org, "/defaults/logo.png")).toBe(false);
    expect(isTenantImageKey(org, "https://x/y")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/asset-keys.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/asset-keys.ts`**

```ts
// Pure guard for tenant-owned R2 image keys. Mirrors imageStorageKey in
// lib/storage.ts (kept separate so this file has no S3 client at load time).
// A stored image.url that is not a direct URL MUST match this before it is
// presigned or deleted — the branding JSON is tenant input, and without the
// check a tenant could name any object in the shared bucket.
const SEGMENT = /^[A-Za-z0-9_-]+$/;

export function isTenantImageKey(organizationId: string, key: string): boolean {
  const prefix = `branding/${organizationId}/images/`;
  if (!key.startsWith(prefix)) return false;
  const assetId = key.slice(prefix.length);
  return SEGMENT.test(assetId);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/asset-keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Enforce it in `saveBranding`**

Add `import { isTenantImageKey } from "@/lib/asset-keys";`. Right after the `printerConfig !== undefined` upload loop (the block that rewrites `pending:` URLs) and before the "Derive a v2 printerLayout" comment, add:

```ts
  // Every remaining non-direct image url must be one of THIS org's keys. The
  // JSON is tenant input; a foreign key here would later be presigned for the
  // browser and deleted as an "orphan" — i.e. read/delete of any bucket object.
  if (printerConfig !== undefined) {
    for (const screen of PRINTER_SCREENS) {
      for (const o of printerConfig.screens[screen].objects) {
        const u = o.type === "image" ? o.image?.url : undefined;
        if (u && !isDirectAssetUrl(u) && !isTenantImageKey(organizationId, u)) {
          return { ok: false, error: "Invalid image reference." };
        }
      }
    }
  }
```

In the `previousImageKeys` loop, change the condition to also require the prefix:

```ts
          if (o.type === "image" && o.image?.url && !isDirectAssetUrl(o.image.url) && isTenantImageKey(organizationId, o.image.url)) {
            previousImageKeys.add(o.image.url);
          }
```

In the orphan cleanup, filter again defensively before deleting:

```ts
    const orphaned = [...previousImageKeys].filter(
      (k) => !newImageKeys.has(k) && isTenantImageKey(organizationId, k),
    );
```

- [ ] **Step 6: Guard the two presign loops in `lib/data.ts`**

Add `import { isTenantImageKey } from "./asset-keys";`. In BOTH `getTenantBranding` and `getDeviceConfig`, the `assetKeys` collection line becomes:

```ts
      if (o.type === "image" && o.image?.url && !isDirectAssetUrl(o.image.url) && isTenantImageKey(organizationId, o.image.url)) assetKeys.add(o.image.url);
```

(Both functions already have `organizationId` in scope — confirm the variable name in each and use it.) A stored foreign key is then simply not presigned (no `signedUrl`), which renders as a missing image rather than a leak.

- [ ] **Step 7: Type-check and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add lib/asset-keys.ts lib/asset-keys.test.ts "app/(tenant)/tenant/branding/actions.ts" lib/data.ts
git commit -m "fix(branding): only presign/delete image keys under the tenant's own R2 prefix"
```

---

### Task 3: Small security batch — usage scope, safe login redirect, Sentry scrub, sharp upgrade + format allowlist

**Files:**
- Modify: `app/api/v1/usage/route.ts`
- Create: `lib/safe-redirect.ts`, `lib/safe-redirect.test.ts`; Modify: `app/(auth)/login/page.tsx:45-49`
- Modify: `lib/observability.ts:13` (+ add a case to `lib/observability.test.ts`)
- Modify: `lib/image.ts`, `lib/image.test.ts`, `package.json`, `package-lock.json`

**Interfaces:**
- Produces: `safeRedirectPath(raw: string | null | undefined, fallback: string): string`.
- Consumes: `hasScope` (`lib/api-scopes.ts`), `apiKey` table.

- [ ] **Step 1: Usage route scope check**

Rewrite `app/api/v1/usage/route.ts` to mirror the trigger route:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKey as apiKeyTable } from "@/lib/db/schema";
import { guardApiRequest } from "@/lib/api/guard";
import { serializeUsage } from "@/lib/api/serialize";
import { apiError, apiJson } from "@/lib/api/respond";
import { hasScope } from "@/lib/api-scopes";
import { getApiUsage } from "@/lib/data";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const guard = await guardApiRequest(req);
  if ("error" in guard) return guard.error;
  const { auth } = guard;

  const [key] = await db.select({ scopes: apiKeyTable.scopes }).from(apiKeyTable).where(eq(apiKeyTable.id, auth.keyId)).limit(1);
  if (!hasScope(key?.scopes, "usage:read")) {
    return apiError("insufficient_scope", "API key lacks the usage:read scope.", 403);
  }

  const usage = await getApiUsage(auth.organizationId);
  return apiJson(serializeUsage(usage));
}
```

- [ ] **Step 2: Safe redirect — failing test**

```ts
// lib/safe-redirect.test.ts
import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("keeps a same-origin path", () => {
    expect(safeRedirectPath("/tenant/stores/st_1?x=1", "/tenant")).toBe("/tenant/stores/st_1?x=1");
  });
  it("falls back for absolute, protocol-relative and backslash forms", () => {
    expect(safeRedirectPath("https://evil.example", "/tenant")).toBe("/tenant");
    expect(safeRedirectPath("//evil.example", "/tenant")).toBe("/tenant");
    expect(safeRedirectPath("/\\evil.example", "/tenant")).toBe("/tenant");
    expect(safeRedirectPath("javascript:alert(1)", "/tenant")).toBe("/tenant");
  });
  it("falls back for null/empty", () => {
    expect(safeRedirectPath(null, "/tenant")).toBe("/tenant");
    expect(safeRedirectPath("", "/tenant")).toBe("/tenant");
  });
});
```

Run: `npx vitest run lib/safe-redirect.test.ts` → FAIL (module not found).

- [ ] **Step 3: Create `lib/safe-redirect.ts`**

```ts
// Post-login `?redirect=` is attacker-suppliable in a crafted link; Next's
// router.push treats an absolute URL as a hard navigation, so only a plain
// same-origin path may pass through.
export function safeRedirectPath(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  return /^\/(?![/\\])/.test(raw) ? raw : fallback;
}
```

Run the test → PASS. Then in `app/(auth)/login/page.tsx` add `import { safeRedirectPath } from "@/lib/safe-redirect";` and change the destination lines to:

```ts
    const dest =
      role === "platform_admin" ? "/admin" : safeRedirectPath(params.get("redirect"), "/tenant");
```

- [ ] **Step 4: Sentry scrub**

In `lib/observability.ts` change the set to:

```ts
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "x-emqx-webhook-secret"]);
```

Open `lib/observability.test.ts`, find the existing test that asserts `authorization`/`cookie` are redacted, and add an assertion that a header `x-emqx-webhook-secret` (any case) is redacted the same way. Run `npx vitest run lib/observability.test.ts` → PASS.

- [ ] **Step 5: sharp upgrade + allowlist — failing test first**

Append to `lib/image.test.ts` inside the `describe("normalizeUploadImage")` block:

```ts
  it("rejects formats the printer never needs (AVIF/HEIF go through libheif)", async () => {
    const avif = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).avif().toBuffer();
    await expect(normalizeUploadImage(avif)).rejects.toThrow(/unsupported image format/i);
  });
```

Run: `npx vitest run lib/image.test.ts` → the new case FAILS (resolves instead of rejecting).

- [ ] **Step 6: Implement the allowlist and bump sharp**

In `lib/image.ts`, after `const meta = await probe.metadata();` add:

```ts
  // Only what the console has ever accepted. Everything else (AVIF/HEIF/TIFF/
  // …) is refused before any decoder beyond the header probe runs — those
  // native decoders have a history of memory-safety advisories and the printer
  // only ever consumes PNG anyway.
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    throw new Error(`Unsupported image format: ${meta.format ?? "unknown"}`);
  }
```

and near the top, after `MAX_INPUT_PIXELS`:

```ts
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp", "svg", "gif"]);
```

Then run:

```bash
npm install sharp@^0.35.4
npm install -D shadcn@^4.8.3 && npm uninstall shadcn && npm install -D shadcn@^4.8.3
```

(Goal: `sharp` ≥ 0.35.4 in `dependencies`, `shadcn` only in `devDependencies` — it is a CLI, never imported at runtime. Verify with `grep -n '"sharp"\|"shadcn"' package.json`.)

Run: `npx vitest run lib/image.test.ts` → PASS (all cases incl. the new one). Run `npm audit --omit=dev 2>&1 | grep -i "sharp" || echo "sharp clean"` → sharp no longer listed.

- [ ] **Step 7: Type-check and full suite, then commit**

Run: `npx tsc --noEmit && npm test` → clean.

```bash
git add app/api/v1/usage/route.ts lib/safe-redirect.ts lib/safe-redirect.test.ts "app/(auth)/login/page.tsx" lib/observability.ts lib/observability.test.ts lib/image.ts lib/image.test.ts package.json package-lock.json
git commit -m "fix(security): usage scope check, safe login redirect, scrub webhook secret, sharp 0.35.4 + format allowlist"
```

---

### Task 4: Expire undelivered triggers instead of counting them as "stuck" forever

**Files:**
- Create: `lib/command-expiry.ts`, `lib/command-expiry.test.ts`
- Modify: `lib/alerts-sync.ts` (`evaluateAndPersistAlerts`), `lib/data.ts` (four `stuckPending` predicates at ~1195, ~1345, ~1986, ~2090)

**Interfaces:**
- Produces: `isExpiredPending(cmd: { status: string; expiresAt: Date | null }, now: Date): boolean`; `stuckPendingTriggerWhere(now: Date, stuckMinutes: number): SQL` (drizzle condition); `expireStaleCommands(now: Date): Promise<number>`.
- Consumes: `deviceCommand` table (`status` enum includes `"expired"`, which nothing writes today), `STUCK_PENDING_MINUTES` (`lib/health.ts`).

Background: a trigger row is `pending` with `expiresAt = createdAt + 60 s`. If the device never acks, nothing ever changes the row (the heartbeat republish window is `createdAt < now-60s AND expiresAt > now`, unsatisfiable for a 60 s TTL). Every "stuck pending" query is `type='trigger' AND status='pending' AND createdAt < now-30min` with no upper bound, so the KPI grows forever and the `documents-stuck` alert never resolves.

- [ ] **Step 1: Failing tests**

```ts
// lib/command-expiry.test.ts
import { describe, expect, it } from "vitest";
import { isExpiredPending } from "./command-expiry";

const NOW = new Date("2026-09-09T10:00:00Z");

describe("isExpiredPending", () => {
  it("is true for a pending row whose expiresAt has passed", () => {
    expect(isExpiredPending({ status: "pending", expiresAt: new Date("2026-09-09T09:59:00Z") }, NOW)).toBe(true);
  });
  it("is false while the TTL is still open", () => {
    expect(isExpiredPending({ status: "pending", expiresAt: new Date("2026-09-09T10:00:30Z") }, NOW)).toBe(false);
  });
  it("never expires desired-state rows (null expiresAt) or terminal rows", () => {
    expect(isExpiredPending({ status: "pending", expiresAt: null }, NOW)).toBe(false);
    expect(isExpiredPending({ status: "acked", expiresAt: new Date("2026-09-09T09:00:00Z") }, NOW)).toBe(false);
  });
});
```

Run: `npx vitest run lib/command-expiry.test.ts` → FAIL.

- [ ] **Step 2: Create `lib/command-expiry.ts`**

```ts
// Terminal state for triggers nobody acked. A trigger carries
// expiresAt = createdAt + 60 s (app/api/v1/devices/[deviceId]/trigger/route.ts)
// because it is a QR for the customer at the counter NOW; once that passes it
// must become `expired`, not sit `pending` forever inflating every "stuck
// pending" KPI and keeping the documents-stuck alert open. The heartbeat
// republish already refuses expired rows; this sweep just records the fact.
import { and, eq, gt, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { deviceCommand } from "./db/schema";

export function isExpiredPending(
  cmd: { status: string; expiresAt: Date | null },
  now: Date,
): boolean {
  return cmd.status === "pending" && cmd.expiresAt !== null && cmd.expiresAt.getTime() < now.getTime();
}

/** WHERE for "a trigger that is genuinely stuck": pending, older than the
 *  stuck threshold, AND not merely past its TTL (those are `expired` in
 *  waiting — the sweep below records them; until it runs they must not count). */
export function stuckPendingTriggerWhere(now: Date, stuckMinutes: number): SQL {
  const stuckCut = new Date(now.getTime() - stuckMinutes * 60_000);
  return and(
    eq(deviceCommand.type, "trigger"),
    eq(deviceCommand.status, "pending"),
    lt(deviceCommand.createdAt, stuckCut),
    or(isNull(deviceCommand.expiresAt), gt(deviceCommand.expiresAt, now)),
  )!;
}

/** Flip every pending command whose TTL has passed to `expired`. Idempotent;
 *  returns how many rows changed. Called from the daily health sweep. */
export async function expireStaleCommands(now: Date): Promise<number> {
  const rows = await db
    .update(deviceCommand)
    .set({ status: "expired", result: sql`coalesce(${deviceCommand.result}, 'ttl_expired')` })
    .where(
      and(
        eq(deviceCommand.status, "pending"),
        isNotNull(deviceCommand.expiresAt),
        lt(deviceCommand.expiresAt, now),
      ),
    )
    .returning({ id: deviceCommand.id });
  return rows.length;
}
```

Run: `npx vitest run lib/command-expiry.test.ts` → PASS.

- [ ] **Step 3: Use the shared predicate in `lib/data.ts`**

Add `import { stuckPendingTriggerWhere } from "./command-expiry";`. Replace each of the four stuck-pending `.where(...)` clauses:

- `getTenantSummaries` (~1195): `.where(stuckPendingTriggerWhere(new Date(), STUCK_PENDING_MINUTES))` (keep the `.groupBy`).
- `getCustomerDetail` (~1342-1350): `.where(and(eq(deviceCommand.organizationId, organizationId), stuckPendingTriggerWhere(now, STUCK_PENDING_MINUTES)))`.
- `getPlatformHealth` (~1986): `.where(stuckPendingTriggerWhere(now, STUCK_PENDING_MINUTES))` — check what `now`/`stuckCut` variable that function uses (`ms(...)` helper around line 1921) and pass the function's `now` Date; if it only has a `ms` helper, add `const now = new Date()` at the top of that scope or reuse an existing one.
- `getAlertInputs` (~2090): `.where(stuckPendingTriggerWhere(now, STUCK_PENDING_MINUTES))`.

Remove now-unused `stuckCutoff`/`stuckCut` locals (tsc/eslint will flag them).

- [ ] **Step 4: Run the sweep from the health cron**

In `lib/alerts-sync.ts`, add `import { expireStaleCommands } from "./command-expiry";` and in `evaluateAndPersistAlerts` change the first line to:

```ts
  const now = new Date();
  // Record TTL-expired triggers before evaluating, so the stuck-pending alert
  // reflects reality (fail-open: a failed sweep must not block the evaluation).
  try {
    await expireStaleCommands(now);
  } catch (err) {
    console.error("[health] expiring stale commands failed", err);
  }
  await reconcileOfflineDevices(now);
```

- [ ] **Step 5: Type-check, suite, commit**

Run: `npx tsc --noEmit && npm test` → clean.

```bash
git add lib/command-expiry.ts lib/command-expiry.test.ts lib/alerts-sync.ts lib/data.ts
git commit -m "fix(health): expire TTL-passed triggers and stop counting them as stuck pending"
```

---

### Task 5: Device action fixes — validate pairing code on tenant claim, keep pause on unassign, fill freed slot on admin delete

**Files:**
- Modify: `app/(tenant)/tenant/stores/[storeId]/actions.ts:37-41`
- Modify: `lib/device-claim.ts` (top of `claimDevice`)
- Modify: `lib/actions/devices.ts` (`deleteDevice` ~211-244, `unassignDevice` ~332-335)

**Interfaces:**
- Consumes: `isValidPairingCode` (`lib/provisioning.ts:39-42`), `fillFreeSlots({ organizationId, actor })` (`lib/invoices.ts:708`).

- [ ] **Step 1: Reject malformed pairing codes in the tenant claim action**

In `app/(tenant)/tenant/stores/[storeId]/actions.ts` add `import { isValidPairingCode } from "@/lib/provisioning";` and replace the `if (!pairingCode) { … }` block with:

```ts
  // A code that cannot have been shown by a device must never reach
  // claimDevice: its create-row path would mint a phantom "New Printer" that
  // occupies a paid slot or gets prorated, while the real device keeps polling.
  if (!isValidPairingCode(pairingCode)) {
    return { ok: false, error: "Enter the 8-character code shown on the printer (e.g. ABCD-EFGH)." };
  }
```

- [ ] **Step 2: Same guard inside `claimDevice` (defence for every caller)**

In `lib/device-claim.ts`, import `isValidPairingCode` from `./provisioning` (check the file's existing import style — it may already import from `./provisioning`) and add as the first statement of `claimDevice`:

```ts
  if (!isValidPairingCode(pairingCode)) throw new Error("Unknown pairing code");
```

(The action's existing `"Unknown pairing code"` mapping then becomes reachable.)

- [ ] **Step 3: `unassignDevice` must not touch status**

Change the update to:

```ts
  await db
    .update(deviceTable)
    .set({ storeId: null })
    .where(eq(deviceTable.id, deviceId));
```

(Forcing `offline` let the next heartbeat's `CASE WHEN status='paused'` resurrect a tenant-paused device.)

- [ ] **Step 4: `deleteDevice` hands its slot to a waiting unpaid device**

Add `import { fillFreeSlots } from "@/lib/invoices";`. Extend the select to include `subscriptionPaidAt: deviceTable.subscriptionPaidAt`. After the `deprovisionDeviceMqtt` try/catch and before the `revalidatePath` calls add:

```ts
  // The deleted device no longer counts as paid, so a slot is now free. Give
  // it to the replacement the customer may already have claimed (and been
  // prorated for) — the same follow-up the registry RMA path does. Fail-open.
  if (device.subscriptionPaidAt) {
    try {
      await fillFreeSlots({
        organizationId: device.organizationId,
        actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
      });
    } catch (err) {
      console.error("[billing] filling the slot freed by a device delete failed", err);
    }
  }
```

- [ ] **Step 5: Type-check, suite, commit**

Run: `npx tsc --noEmit && npm test` → clean.

```bash
git add "app/(tenant)/tenant/stores/[storeId]/actions.ts" lib/device-claim.ts lib/actions/devices.ts
git commit -m "fix(devices): validate pairing code on claim, keep pause on unassign, fill freed slot on delete"
```

---

### Task 6: Billing — lead-window proration horizon, RMA'd device proration, restore refills slots

**Files:**
- Modify: `lib/invoicing.ts` (new pure `prorationMonthsThrough`), `lib/invoicing.test.ts` (add cases)
- Modify: `lib/invoices.ts` (`settleClaimBilling` ~767-830; `markInvoicePaid` proration branch ~401-419)
- Modify: `lib/actions/offboarding.ts` (`restoreCustomerAction` after the un-retire update, ~241-258)

**Interfaces:**
- Produces: `prorationMonthsThrough(a: { renewsAt: Date; now: Date; openRenewalPeriodEnd: Date | null }): number` in `lib/invoicing.ts`.
- Consumes: `monthsRemainingUntil`, `MONTHS_PER_YEAR`, `fillFreeSlots`, `factoryDevice` table (already imported in `lib/invoices.ts`).

Background (bug 1): the renewal invoice is issued 30 days before `renewsAt`, priced at the paid-device count at that moment. A device claimed inside that window is prorated only until `renewsAt` (1 month), and nothing ever bills it for the new year: `issueProrationsForUnpaidDevices` skips it as "already prorated", and once its $15 proration is paid it holds a slot. Fix at the source: when an OPEN subscription invoice for the next period already exists, the claim proration covers through that invoice's `periodEnd` (this year's remainder + the whole next year, in one invoice). Bug 2: paying a proration for a device already `rma`/`retired` activates a dead unit. Bug 3: restoring an archived customer un-retires registry rows but never re-activates devices into the slots the org still holds.

- [ ] **Step 1: Failing tests in `lib/invoicing.test.ts`**

Append:

```ts
describe("prorationMonthsThrough", () => {
  const renewsAt = new Date("2026-10-01T00:00:00Z");
  it("with no open renewal, bills the months left until renewsAt (min 1)", () => {
    expect(prorationMonthsThrough({ renewsAt, now: new Date("2026-09-11T00:00:00Z"), openRenewalPeriodEnd: null })).toBe(1);
    expect(prorationMonthsThrough({ renewsAt, now: new Date("2026-10-05T00:00:00Z"), openRenewalPeriodEnd: null })).toBe(1);
    expect(prorationMonthsThrough({ renewsAt, now: new Date("2026-04-01T00:00:00Z"), openRenewalPeriodEnd: null })).toBe(6);
  });
  it("with an open renewal already issued, covers the next year too", () => {
    const nextEnd = new Date("2027-10-01T00:00:00Z");
    // 20 days before the anniversary: 1 (remainder) + 12 (the issued year).
    expect(prorationMonthsThrough({ renewsAt, now: new Date("2026-09-11T00:00:00Z"), openRenewalPeriodEnd: nextEnd })).toBe(13);
    // After the anniversary with the renewal still unpaid: what is left of the issued year.
    expect(prorationMonthsThrough({ renewsAt, now: new Date("2026-11-15T00:00:00Z"), openRenewalPeriodEnd: nextEnd })).toBe(11);
  });
});
```

Add `prorationMonthsThrough` to the file's import from `./invoicing`. Run: `npx vitest run lib/invoicing.test.ts` → FAIL (not exported).

- [ ] **Step 2: Implement in `lib/invoicing.ts`** (after `prorationMonths`)

```ts
/**
 * Months a claim-time proration must cover. Normally the rest of the current
 * subscription year. But once the renewal invoice for the NEXT year has been
 * issued (30 days ahead, priced at that moment's paid devices), a device
 * claimed now is missing from it — so its proration must run through the end
 * of that issued year as well, or it rides the new year for one month's price.
 * Never below one month (see prorationMonths); may exceed 12.
 */
export function prorationMonthsThrough(a: {
  renewsAt: Date;
  now: Date;
  openRenewalPeriodEnd: Date | null;
}): number {
  if (a.openRenewalPeriodEnd === null) return prorationMonths(monthsRemainingUntil(a.renewsAt, a.now));
  if (a.now.getTime() >= a.renewsAt.getTime()) {
    return Math.max(1, monthsRemainingUntil(a.openRenewalPeriodEnd, a.now));
  }
  return Math.max(1, monthsRemainingUntil(a.renewsAt, a.now)) + MONTHS_PER_YEAR;
}
```

`MONTHS_PER_YEAR` is already imported in `lib/invoicing.ts` from `./billing-period` (verify; add if not). Run the test → PASS.

- [ ] **Step 3: Use it in `settleClaimBilling` (`lib/invoices.ts`)**

Import `prorationMonthsThrough` from `./invoicing`. Inside `settleClaimBilling`, after the free-slot early return and before `await issueProrationInvoice({...})`, add:

```ts
    // Renewal for the next year already issued and unpaid? Then this device
    // is missing from it: bill it through the end of that year in one go.
    const [openRenewal] = await db
      .select({ periodEnd: invoice.periodEnd })
      .from(invoice)
      .where(
        and(
          eq(invoice.organizationId, organizationId),
          eq(invoice.kind, "subscription"),
          eq(invoice.status, "open"),
          eq(invoice.periodStart, settings.renewsAt),
        ),
      )
      .limit(1);
    const openRenewalPeriodEnd = openRenewal?.periodEnd ?? null;
```

and change the `issueProrationInvoice` call's `monthsRemaining` / `periodEnd` to:

```ts
      monthsRemaining: prorationMonthsThrough({ renewsAt: settings.renewsAt, now, openRenewalPeriodEnd }),
      periodStart: periodStartFor(settings.startedAt, now),
      periodEnd: openRenewalPeriodEnd ?? periodEndFor(settings.startedAt, now),
```

(Drop the old `prorationMonths(monthsRemainingUntil(...))` expression there; `prorationMonths` stays in use by `issueProrationsForUnpaidDevices`.) Check whether `issueProrationInvoice` or `prorationAmountCents` caps months at 12 — if `prorationAmountCents` clamps, remove that clamp so 13-month prorations price correctly, and add one assertion in `lib/invoicing.test.ts` that `prorationAmountCents(1500, 13)` equals `19500`.

- [ ] **Step 4: Proration paid for an RMA'd/retired device**

In `markInvoicePaid`'s `inv.kind === "proration" && inv.deviceId` branch, after the slot increment and INSTEAD of the unconditional `activateDeviceIntoSlot`, do:

```ts
    // The device may have gone to RMA/retired while its proration was open
    // (DOA replacement). The customer still paid for a slot — keep it — but
    // never park it on a dead unit: hand it to whoever is waiting instead.
    const [reg] = await db
      .select({ status: factoryDevice.status })
      .from(factoryDevice)
      .where(eq(factoryDevice.deviceId, inv.deviceId))
      .limit(1);
    if (reg && (reg.status === "rma" || reg.status === "retired")) {
      console.warn("[billing] proration paid for a retired/RMA device; filling the slot elsewhere", {
        invoiceId: inv.id,
        deviceId: inv.deviceId,
        organizationId: inv.organizationId,
      });
      await fillFreeSlots({ organizationId: inv.organizationId, now, actor });
    } else {
      await activateDeviceIntoSlot(inv.deviceId, inv.organizationId, now, actor);
    }
    return { ok: true, organizationId: inv.organizationId };
```

(`fillFreeSlots` is defined later in the same file — function declarations hoist, so the reference is fine.)

- [ ] **Step 5: Restore refills the slots the org still holds**

In `lib/actions/offboarding.ts`, `restoreCustomerAction`: after the un-retire `try/catch` block and before the `recordAudit(... orgRestored ...)` call, add (import `fillFreeSlots` from `@/lib/invoices`):

```ts
  // Retirement cleared subscriptionPaidAt on every device but left
  // paidDeviceSlots intact (the customer's entitlement). Put the devices back
  // into those slots now, oldest claim first — otherwise they stay unpaid and
  // every trigger is refused after the trial. Fail-open, like the un-retire.
  try {
    await fillFreeSlots({
      organizationId,
      actor: { type: "user", id: ctx.user.id, label: ctx.user.email },
    });
  } catch (err) {
    console.error("[offboarding] re-activating devices into paid slots on restore failed", err);
  }
```

- [ ] **Step 6: Type-check, suite, commit**

Run: `npx tsc --noEmit && npm test` → clean.

```bash
git add lib/invoicing.ts lib/invoicing.test.ts lib/invoices.ts lib/actions/offboarding.ts
git commit -m "fix(billing): prorate through an issued renewal, skip RMA'd devices on proration payment, refill slots on restore"
```

---

### Task 7: Release the pin idempotency claim when the change throws

**Files:**
- Modify: `lib/api/pin-idempotency.ts` (add `releasePinIdempotency`, `withPinClaim`)
- Create: `lib/api/pin-idempotency.test.ts`
- Modify: `app/api/v1/devices/[deviceId]/pin/route.ts`, `app/api/v1/stores/[storeId]/pin/route.ts`, `app/api/v1/org/pin/route.ts` (every `applyScopedPinChange … storePinIdempotentResponse` sequence)

**Interfaces:**
- Produces: `releasePinIdempotency(nsKey: string, organizationId: string): Promise<void>`; `withPinClaim<T>(claim: { nsKey: string | null; organizationId: string }, work: () => Promise<T>, release?: typeof releasePinIdempotency): Promise<T>`.

Background: the claim row is inserted with `responseStatus = 0` before `applyScopedPinChange`; if that throws, the row stays at 0 forever and every retry with the same `Idempotency-Key` gets `409 still in progress`. The trigger route deletes its claim on failure; the pin routes don't.

- [ ] **Step 1: Failing test**

```ts
// lib/api/pin-idempotency.test.ts
import { describe, expect, it, vi } from "vitest";
import { withPinClaim } from "./pin-idempotency";

describe("withPinClaim", () => {
  it("returns the work's result and releases nothing on success", async () => {
    const release = vi.fn(async () => {});
    await expect(withPinClaim({ nsKey: "pin:k", organizationId: "org" }, async () => 42, release)).resolves.toBe(42);
    expect(release).not.toHaveBeenCalled();
  });
  it("releases the claim and rethrows when the work throws", async () => {
    const release = vi.fn(async () => {});
    await expect(
      withPinClaim({ nsKey: "pin:k", organizationId: "org" }, async () => { throw new Error("db down"); }, release),
    ).rejects.toThrow("db down");
    expect(release).toHaveBeenCalledWith("pin:k", "org");
  });
  it("does not release when no key was claimed", async () => {
    const release = vi.fn(async () => {});
    await expect(
      withPinClaim({ nsKey: null, organizationId: "org" }, async () => { throw new Error("x"); }, release),
    ).rejects.toThrow("x");
    expect(release).not.toHaveBeenCalled();
  });
});
```

This test imports `lib/api/pin-idempotency.ts`, which imports `@/lib/db` (module-load env read only — fine under vitest's `.env.local`; it never queries). Run: `npx vitest run lib/api/pin-idempotency.test.ts` → FAIL (`withPinClaim` not exported).

- [ ] **Step 2: Implement in `lib/api/pin-idempotency.ts`**

Append:

```ts
/** Drop a claim whose work failed, so the caller's retry with the same key
 *  runs again instead of hitting 409 forever. Mirrors the trigger route. */
export async function releasePinIdempotency(nsKey: string, organizationId: string): Promise<void> {
  await db
    .delete(apiIdempotency)
    .where(and(eq(apiIdempotency.key, nsKey), eq(apiIdempotency.organizationId, organizationId)));
}

/** Run the pin change under an owned claim; on throw, release the claim
 *  (best-effort) and rethrow so the route still answers 500. */
export async function withPinClaim<T>(
  claim: { nsKey: string | null; organizationId: string },
  work: () => Promise<T>,
  release: (nsKey: string, organizationId: string) => Promise<void> = releasePinIdempotency,
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (claim.nsKey) {
      try {
        await release(claim.nsKey, claim.organizationId);
      } catch (releaseErr) {
        console.error("[pin] releasing idempotency claim failed", releaseErr);
      }
    }
    throw err;
  }
}
```

Also update the comment near `if (!existing) return { owned: false, kind: "in_progress" };` — it mentions a "retention sweep" that does not exist; reword to "the winner released it after a failed change".

Run the test → PASS.

- [ ] **Step 3: Wrap every owned-claim sequence in the three routes**

Pattern (device route, `mode` branch) — replace from `const res = await applyScopedPinChange({` through `return apiJson(modeBody, 200);` with:

```ts
    const modeBody = await withPinClaim({ nsKey, organizationId: auth.organizationId }, async () => {
      const res = await applyScopedPinChange({
        organizationId: auth.organizationId,
        change: { scope: "device", deviceId, mode: v.mode, url: null },
        actor: { type: "system" },
        via: "api",
      });
      const effectiveUrl = await resolveDeviceEffectiveUrl(auth.organizationId, dev.storeId, { pinMode: v.mode, pinnedUrl: null });
      const body = deviceBody(deviceId, v.mode, null, effectiveUrl, res.affectedDevices);
      if (nsKey) await storePinIdempotentResponse(nsKey, auth.organizationId, body);
      return body;
    });
    return apiJson(modeBody, 200);
```

Apply the same shape to: the device route `url` branch; the store route `mode` and `url` branches; the org route `url` branch. In each, everything between `const nsKey = claim.nsKey;` and the final `return apiJson(...)` moves inside the `withPinClaim` callback, and the callback returns the body. Import `withPinClaim` from `@/lib/api/pin-idempotency` in all three files. The DELETE handlers take no claim and stay as they are.

- [ ] **Step 4: Type-check, suite, commit**

Run: `npx tsc --noEmit && npm test` → clean.

```bash
git add lib/api/pin-idempotency.ts lib/api/pin-idempotency.test.ts "app/api/v1/devices/[deviceId]/pin/route.ts" "app/api/v1/stores/[storeId]/pin/route.ts" app/api/v1/org/pin/route.ts
git commit -m "fix(api): release the pin Idempotency-Key claim when the change fails"
```

---

### Task 8: Offline audit + owner email for devices the presence webhook already flipped

**Files:**
- Modify: `lib/device-status.ts` (add `shouldNotifyOffline`), `lib/device-status.test.ts` (add cases)
- Modify: `lib/alerts-sync.ts` (`reconcileOfflineDevices`)

**Interfaces:**
- Produces: `shouldNotifyOffline(d: { status: string; lastSeenAt: Date | null }, lastNotifiedAt: Date | null, now: Date, offlineMinutes?: number): boolean`.
- Consumes: `auditLog` table, `AUDIT.deviceWentOffline` (`"device.went_offline"`), `deviceOfflineEmail`, `getOrgEmailContext`.

Background: the MQTT presence webhook writes `status = 'offline'` the instant a device disconnects. `reconcileOfflineDevices` only looks at rows still `online`, so on the normal path it finds nothing and the `device.went_offline` audit + "A Maratus printer went offline" email never fire. The flip itself is fine; the notification must key off staleness plus "not yet notified for this offline episode" (an episode starts at `lastSeenAt`; a reconnect bumps `lastSeenAt`, so the next episode notifies again).

- [ ] **Step 1: Failing tests** (append to `lib/device-status.test.ts`)

```ts
describe("shouldNotifyOffline", () => {
  const NOW = new Date("2026-09-09T10:00:00Z");
  const stale = new Date("2026-09-09T09:00:00Z");
  const fresh = new Date("2026-09-09T09:55:00Z");
  it("notifies a stale device (online or offline stored) that was never notified", () => {
    expect(shouldNotifyOffline({ status: "online", lastSeenAt: stale }, null, NOW)).toBe(true);
    expect(shouldNotifyOffline({ status: "offline", lastSeenAt: stale }, null, NOW)).toBe(true);
  });
  it("does not notify twice for the same episode", () => {
    expect(shouldNotifyOffline({ status: "offline", lastSeenAt: stale }, new Date("2026-09-09T09:30:00Z"), NOW)).toBe(false);
  });
  it("notifies again after a reconnect started a new episode", () => {
    expect(shouldNotifyOffline({ status: "offline", lastSeenAt: stale }, new Date("2026-09-09T08:00:00Z"), NOW)).toBe(true);
  });
  it("never notifies paused, fresh, or never-seen devices", () => {
    expect(shouldNotifyOffline({ status: "paused", lastSeenAt: stale }, null, NOW)).toBe(false);
    expect(shouldNotifyOffline({ status: "online", lastSeenAt: fresh }, null, NOW)).toBe(false);
    expect(shouldNotifyOffline({ status: "offline", lastSeenAt: null }, null, NOW)).toBe(false);
  });
});
```

Add `shouldNotifyOffline` to the import. Run: `npx vitest run lib/device-status.test.ts` → FAIL.

- [ ] **Step 2: Implement in `lib/device-status.ts`**

```ts
/** Should the owner be told this device is offline? True when it is stale
 * (not paused, seen at least once, silent past the threshold) and no
 * notification exists for THIS offline episode — i.e. none since lastSeenAt.
 * The presence webhook flips status instantly, so stored status is not a
 * signal here; staleness is. */
export function shouldNotifyOffline(
  d: { status: string; lastSeenAt: Date | null },
  lastNotifiedAt: Date | null,
  now: Date,
  offlineMinutes = OFFLINE_MINUTES,
): boolean {
  if (d.status === "paused" || !d.lastSeenAt) return false;
  if (now.getTime() - d.lastSeenAt.getTime() <= offlineMinutes * 60_000) return false;
  return lastNotifiedAt === null || lastNotifiedAt.getTime() <= d.lastSeenAt.getTime();
}
```

Run the test → PASS.

- [ ] **Step 3: Rework `reconcileOfflineDevices` in `lib/alerts-sync.ts`**

Replace the function body with:

```ts
export async function reconcileOfflineDevices(now: Date): Promise<number> {
  const rows = await db
    .select({
      id: deviceTable.id,
      organizationId: deviceTable.organizationId,
      status: deviceTable.status,
      lastSeenAt: deviceTable.lastSeenAt,
      name: deviceTable.name,
      storeName: storeTable.name,
    })
    .from(deviceTable)
    .leftJoin(storeTable, eq(storeTable.id, deviceTable.storeId))
    .where(and(ne(deviceTable.status, "paused"), isNotNull(deviceTable.claimedAt)));

  // 1. Stored-status repair (unchanged): only "online" rows that went stale.
  const toFlip = rows.filter((r) => shouldMarkOffline(r, now));
  if (toFlip.length > 0) {
    await db
      .update(deviceTable)
      .set({ status: "offline" })
      .where(inArray(deviceTable.id, toFlip.map((r) => r.id)));
  }

  // 2. Notification: every stale device (the presence webhook may already have
  //    flipped it) that has no went_offline audit row since its lastSeenAt.
  const staleIds = rows.filter((r) => r.lastSeenAt !== null).map((r) => r.id);
  const lastNotified = new Map<string, Date>();
  if (staleIds.length > 0) {
    const notes = await db
      .select({ targetId: auditLogTable.targetId, last: max(auditLogTable.createdAt) })
      .from(auditLogTable)
      .where(and(eq(auditLogTable.action, AUDIT.deviceWentOffline), inArray(auditLogTable.targetId, staleIds)))
      .groupBy(auditLogTable.targetId);
    for (const n of notes) if (n.targetId && n.last) lastNotified.set(n.targetId, n.last);
  }
  const toNotify = rows.filter((r) => shouldNotifyOffline(r, lastNotified.get(r.id) ?? null, now));
  if (toNotify.length === 0) return toFlip.length;

  for (const r of toNotify) {
    await recordAudit({
      organizationId: r.organizationId,
      actor: { type: "system" },
      action: AUDIT.deviceWentOffline,
      target: { type: "device", id: r.id },
      metadata: { lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null },
    });
  }

  // Notify each affected org's owner once, listing the devices that dropped.
  const byOrg = new Map<string, typeof toNotify>();
  for (const r of toNotify) {
    const arr = byOrg.get(r.organizationId) ?? [];
    arr.push(r);
    byOrg.set(r.organizationId, arr);
  }
  for (const [orgId, devs] of byOrg) {
    const { ownerEmail, orgName } = await getOrgEmailContext(orgId);
    if (!ownerEmail) continue;
    const mail = deviceOfflineEmail({
      orgName,
      devices: devs.map((d) => ({
        name: d.name,
        storeName: d.storeName ?? "—",
        lastSeenLabel: d.lastSeenAt
          ? `${d.lastSeenAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
          : "never",
      })),
    });
    await sendEmail(ownerEmail, mail.subject, mail.html);
  }

  return toFlip.length;
}
```

Update imports: add `ne`, `isNotNull`, `max` from `drizzle-orm`; add `auditLog as auditLogTable` to the schema import; add `shouldNotifyOffline` next to `shouldMarkOffline` from `./device-status`. Keep the function's return value (count of flips) since the cron summary may use it — check callers with `grep -rn reconcileOfflineDevices lib app`.

- [ ] **Step 4: Type-check, suite, commit**

Run: `npx tsc --noEmit && npm test` → clean.

```bash
git add lib/device-status.ts lib/device-status.test.ts lib/alerts-sync.ts
git commit -m "fix(health): audit + email offline devices even when the presence webhook flipped them first"
```

---

## Out of scope (decisions pending)

- `slotsAfterPayment` writing the renewal's lower slot count before `renewsAt` (shrinks the pool for the last month of the paid year).
- `deviceCommand.deviceId` `onDelete: cascade` → `set null` (migration 0045) so deleting a device keeps its acked triggers in the open overage period.
- Zero-touch auto-claim possession proof and the settings-PIN hash (`sha256(salt+PIN)` → scrypt) — firmware-affecting.
- Low findings: leap-day `renewsAt` drift, first-invoice period label, admin overview device denominator, serial-less paused device in `retireDeviceWithCustomer`.

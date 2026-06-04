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

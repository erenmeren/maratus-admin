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

const SENSITIVE_HEADERS = new Set(["authorization", "cookie"]);

interface ScrubbableEvent {
  request?: {
    url?: string;
    headers?: Record<string, string>;
  };
  transaction?: string;
}

/**
 * Strip secrets the Sentry SDK auto-attaches before an event is sent — the
 * device/API bearer token and cookies (Authorization/Cookie headers). The SDK's
 * onRequestError capture includes raw request headers, so reportError discipline
 * alone is not enough. Mutates a structural subset of the event in place and
 * returns it. (The public /d/<token> URL scrub left with the trigger-only pivot;
 * no capability lives in URLs anymore.)
 */
export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  const headers = event.request?.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (SENSITIVE_HEADERS.has(key.toLowerCase())) headers[key] = "[redacted]";
    }
  }
  return event;
}

export interface SentryInitOptions {
  dsn: string;
  environment: string;
  /** Errors only — no performance tracing (approach B). */
  tracesSampleRate: number;
  /** Scrubs secrets the SDK auto-captures (auth/cookie headers). */
  beforeSend: (event: Sentry.ErrorEvent) => Sentry.ErrorEvent;
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
    beforeSend: (event) => scrubSentryEvent(event),
  };
}

/**
 * Report a swallowed error to Sentry. No-ops automatically when Sentry was never
 * initialized (no DSN). Never include secrets in `extra` — no device or API keys.
 * @param context.path A short static label for the operation (e.g. "ingest.r2-upload"), never a request URL.
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

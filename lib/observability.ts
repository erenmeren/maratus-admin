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

/** Replace a document token in any `/d/<token>` path with a redacted marker. */
function redactDocumentToken(value: string): string {
  return value.replace(/\/d\/[^/?#]+/g, "/d/[redacted]");
}

interface ScrubbableEvent {
  request?: {
    url?: string;
    headers?: Record<string, string>;
  };
  transaction?: string;
}

/**
 * Strip secrets the Sentry SDK auto-attaches before an event is sent: the device
 * bearer token (Authorization header) and the document-token capability (the
 * /d/<token> URL). The SDK's onRequestError capture includes raw request headers
 * and the resolved URL, so reportError discipline alone is not enough. Mutates a
 * structural subset of the event in place and returns it.
 */
export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  const headers = event.request?.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (SENSITIVE_HEADERS.has(key.toLowerCase())) headers[key] = "[redacted]";
    }
  }
  if (event.request?.url) event.request.url = redactDocumentToken(event.request.url);
  if (typeof event.transaction === "string") {
    event.transaction = redactDocumentToken(event.transaction);
  }
  return event;
}

export interface SentryInitOptions {
  dsn: string;
  environment: string;
  /** Errors only — no performance tracing (approach B). */
  tracesSampleRate: number;
  /** Scrubs secrets the SDK auto-captures (auth/cookie headers, /d/<token> URL). */
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
 * initialized (no DSN). Never include secrets in `extra` — no device keys, no
 * document tokens.
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

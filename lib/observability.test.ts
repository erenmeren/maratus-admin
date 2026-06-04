import { describe, it, expect, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { sentryInitOptions, reportError, scrubSentryEvent } from "./observability";

describe("sentryInitOptions", () => {
  it("returns null when no DSN is provided", () => {
    expect(sentryInitOptions({ dsn: undefined, environment: "production" })).toBeNull();
    expect(sentryInitOptions({ dsn: "", environment: "production" })).toBeNull();
  });

  it("returns errors-only init options when a DSN is provided", () => {
    const opts = sentryInitOptions({ dsn: "https://abc@o1.ingest.sentry.io/1", environment: "production" });
    expect(opts).toMatchObject({
      dsn: "https://abc@o1.ingest.sentry.io/1",
      environment: "production",
      tracesSampleRate: 0,
    });
    expect(typeof opts?.beforeSend).toBe("function");
  });

  it("defaults environment to development when omitted", () => {
    const opts = sentryInitOptions({ dsn: "https://abc@o1.ingest.sentry.io/1" });
    expect(opts?.environment).toBe("development");
  });
});

describe("scrubSentryEvent", () => {
  it("redacts the Authorization and Cookie headers (any case)", () => {
    const event = scrubSentryEvent({
      request: { headers: { Authorization: "Bearer secret", cookie: "a=b", "x-keep": "ok" } },
    });
    expect(event.request?.headers).toEqual({
      Authorization: "[redacted]",
      cookie: "[redacted]",
      "x-keep": "ok",
    });
  });

  it("redacts a receipt token in the request url", () => {
    const event = scrubSentryEvent({ request: { url: "https://app.ditto/r/abc123token?x=1" } });
    expect(event.request?.url).toBe("https://app.ditto/r/[redacted]?x=1");
  });

  it("redacts a receipt token in the transaction name", () => {
    const event = scrubSentryEvent({ transaction: "GET /r/abc123token" });
    expect(event.transaction).toBe("GET /r/[redacted]");
  });

  it("is a no-op when there is no request or transaction", () => {
    expect(scrubSentryEvent({})).toEqual({});
  });
});

describe("reportError", () => {
  it("forwards the error to Sentry.captureException with path tag and extra", () => {
    const err = new Error("boom");
    reportError(err, { path: "api/ingest", extra: { orgId: "org_1" } });
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { path: "api/ingest" },
      extra: { orgId: "org_1" },
    });
  });
});

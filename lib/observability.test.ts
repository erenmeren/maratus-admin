import { describe, it, expect, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { sentryInitOptions, reportError } from "./observability";

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

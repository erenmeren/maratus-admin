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

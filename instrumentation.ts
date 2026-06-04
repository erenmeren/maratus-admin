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

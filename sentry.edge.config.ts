// Edge runtime Sentry init. Loaded by instrumentation.ts `register()`.
import * as Sentry from "@sentry/nextjs";
import { sentryInitOptions } from "@/lib/observability";

const opts = sentryInitOptions({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT,
});
if (opts) Sentry.init(opts);

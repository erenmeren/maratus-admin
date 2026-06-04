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

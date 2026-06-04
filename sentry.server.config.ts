// Node.js runtime Sentry init. Loaded by instrumentation.ts `register()`.
import * as Sentry from "@sentry/nextjs";
import { getEnv } from "@/lib/env";
import { sentryInitOptions } from "@/lib/observability";

const env = getEnv();
const opts = sentryInitOptions({ dsn: env.SENTRY_DSN, environment: env.SENTRY_ENVIRONMENT });
if (opts) Sentry.init(opts);

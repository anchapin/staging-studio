/**
 * Server-side Sentry instrumentation for Next.js (issue #1107).
 *
 * Two responsibilities:
 *  1. Load the right `sentry.{server,edge}.config.ts` file based on the
 *     current runtime — this is what makes `Sentry.init()` actually run,
 *     since the SDK webpack/turbopack plugins (installed by
 *     `withSentryConfig` in `next.config.ts`) only resolve those files
 *     on the matching runtime.
 *  2. Hook Next.js's server-side request error API
 *     (`onRequestError`) to `Sentry.captureRequestError` so unhandled
 *     server errors reach CAPI / the Sentry server endpoint.
 *
 * Initialization is gated on `NEXT_PUBLIC_SENTRY_DSN`: the SDK
 * no-ops `Sentry.init()` when DSN is unset, so importing the config
 * files in dev is safe and cheap. The two config files themselves
 * also early-return their capture helpers when DSN is absent, so
 * call sites don't have to double-guard.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Node runtime is the only one this app uses today — middleware.ts
  // runs on Edge but it doesn't reach the Sentry SDK on its own (the
  // server runtime loads it first). If an edge-only route ships, add a
  // `sentry.edge.config.ts` and an `if (NEXT_RUNTIME === "edge")` arm
  // here; the SDK's `register` pattern is documented as runtime-aware.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
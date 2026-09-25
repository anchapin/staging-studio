/**
 * Sentry instrumentation for Next.js server-side error tracking.
 * This file is loaded early in the Next.js server lifecycle.
 */

export async function register() {
  // Server-side Sentry is initialized via sentry.server.config.ts
  // This file enables Next.js instrumentation support
  if (process.env.NODE_ENV === 'development') {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
      console.debug('[Sentry] Skipping server initialization in development (no DSN)');
    }
  }
}

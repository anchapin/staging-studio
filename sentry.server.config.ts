import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance monitoring - sample more in development
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Environment
  environment: process.env.NODE_ENV,

  // Custom tags
  initialScope: {
    tags: {
      service: 'staging-studio',
    },
  },

  // Error filtering
  ignoreErrors: process.env.NODE_ENV !== 'production'
    ? ['ChunkLoadError', 'Failed to fetch', 'NetworkError']
    : undefined,
});

/**
 * Utility to capture server-side errors with additional context.
 */
export const captureServerError = (
  error: unknown,
  context?: Record<string, unknown>
): string | undefined => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return undefined;
  }
  Sentry.captureException(error, { extra: context });
  return Sentry.lastEventId();
};

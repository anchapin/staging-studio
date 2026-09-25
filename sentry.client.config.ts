import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Environment
  environment: process.env.NODE_ENV,

  // Custom tags
  initialScope: {
    tags: {
      service: 'staging-studio',
    },
  },

  // Error filtering - ignore certain errors in development
  ignoreErrors: process.env.NODE_ENV !== 'production'
    ? ['ChunkLoadError', 'Failed to fetch', 'NetworkError']
    : undefined,
});

/**
 * Utility to capture errors with additional context.
 * Use this instead of directly calling Sentry.captureException for typed errors.
 */
export const captureError = (
  error: unknown,
  context?: Record<string, unknown>
): string | undefined => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return undefined;
  }
  Sentry.captureException(error, { extra: context });
  return Sentry.lastEventId();
};

/**
 * Utility to add user context to errors.
 */
export const setUserContext = (user: {
  id: string;
  email?: string;
  username?: string;
} | null): void => {
  Sentry.setUser(user);
};

/**
 * Utility to add custom breadcrumb for debugging.
 */
export const addBreadcrumb = (
  message: string,
  category: string,
  data?: Record<string, unknown>
): void => {
  Sentry.addBreadcrumb({ message, category, data });
};

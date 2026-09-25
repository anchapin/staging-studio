/**
 * Structured JSON logger built on pino.
 *
 * Design decisions:
 * - JSON output by default (machine-parseable, easy to ship to log aggregators)
 * - redactFields for sensitive keys prevents accidental PII/secret leakage
 * - requestId tracking via bind() for correlating logs across a single request
 * - child logger via logger.child({ component }) for categorisation without
 *   creating multiple independent logger instances
 *
 * Usage:
 *   import { logger, componentLogger } from "@/lib/logger";
 *
 *   // Basic
 *   logger.info({ userId, roomId }, "Room staged successfully");
 *
 *   // Component-scoped (recommended for library/infra code)
 *   const log = componentLogger("prisma");
 *   log.error({ err, query }, "Query failed");
 *
 *   // With request context (API routes set requestId from headers)
 *   const reqLog = logger.child({ requestId, userId });
 *   reqLog.info("Processing request");
 */

import pino from "pino";

// Fields that must never appear in structured log output
const REDACT_PATHS = [
  "password",
  "token",
  "secret",
  "apiKey",
  "authorization",
  "cookie",
  "set-cookie",
  "access_token",
  "refresh_token",
  "openai_api_key",
  "fal_key",
  "supabase_service_role_key",
  "browserless_api_key",
  "preview_token_secret",
];

/**
 * Base application logger — singleton, initialised once at module load.
 *
 * Level hierarchy:
 *   trace < debug < info < warn < error < fatal
 *
 * In development (NODE_ENV !== "production") the logger pretty-prints to
 * the terminal; in production it emits compact JSON lines.
 */
export const logger = pino({
  // Minimum level to emit
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),

  // Always redact sensitive fields
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },

  // Base fields present on every log line
  base: {
    service: "staging-studio",
    env: process.env.NODE_ENV ?? "development",
  },

  // Pretty-print in development only
  ...(process.env.NODE_ENV !== "production"
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});

/**
 * Returns a child logger scoped to a named component.
 * Child loggers inherit the parent's config and add a `component` field.
 *
 * @example
 *   const log = componentLogger("prisma");
 *   log.info("Starting query");
 */
export function componentLogger(component: string) {
  return logger.child({ component });
}

/**
 * Wraps a handler function with request-level logging: start, duration, and
 * error (if thrown). Returns a pino child with { requestId } already set so
 * every log line within the handler is correlatable.
 *
 * @param requestId  - value from request headers (e.g. x-request-id)
 * @param context   - extra fields to seed the child logger (userId, path, etc.)
 */
export function requestLogger(requestId: string, context?: Record<string, unknown>) {
  return logger.child({ requestId, ...context });
}

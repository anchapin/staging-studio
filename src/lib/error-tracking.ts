import { ZodError } from "zod";
import { logger } from "@/lib/logger";

/**
 * High-level error categories used for observability grouping.
 * These are distinct from the integration-error classes in error-classify.ts
 * which classify third-party API failures; these classify the application's
 * own error surface.
 */
export enum AppErrorType {
  ValidationError = "ValidationError",
  AuthError = "AuthError",
  DatabaseError = "DatabaseError",
  ExternalApiError = "ExternalApiError",
  UnknownError = "UnknownError",
}

/**
 * Context attached to every tracked error for correlation and debugging.
 */
export interface ErrorContext {
  userId?: string;
  requestId?: string;
  sessionId?: string;
  path?: string;
  method?: string;
  [key: string]: unknown;
}

/**
 * Classifies a raw thrown error into an AppErrorType.
 */
function classifyErrorType(error: unknown): AppErrorType {
  if (error instanceof ZodError) return AppErrorType.ValidationError;

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("auth") ||
      msg.includes("unauthorized") ||
      msg.includes("invalid token") ||
      msg.includes("supabase")
    ) {
      return AppErrorType.AuthError;
    }
    if (
      msg.includes("prisma") ||
      msg.includes("database") ||
      msg.includes("postgres") ||
      msg.includes("unique constraint") ||
      msg.includes("foreign key")
    ) {
      return AppErrorType.DatabaseError;
    }
    if (
      msg.includes("fal") ||
      msg.includes("openai") ||
      msg.includes("fetch") ||
      msg.includes("network") ||
      msg.includes("timeout")
    ) {
      return AppErrorType.ExternalApiError;
    }
  }

  return AppErrorType.UnknownError;
}

/**
 * Logs a structured error event with full context for observability.
 * This does NOT throw — it is a fire-and-forget logger that never disrupts
 * the caller's control flow. If the underlying logger throws (e.g. a
 * transport target is unavailable), the failure is swallowed so the
 * request path is never derailed by an observability bug.
 */
export function trackError(error: unknown, context: ErrorContext = {}): void {
  const errorType = classifyErrorType(error);
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  try {
    logger.error(
      {
        event: "app_error",
        errorType,
        message,
        stack,
        ...context,
      },
      `[${errorType}] ${message}`
    );
  } catch {
    // Intentionally swallowed — see the JSDoc contract above.
  }
}

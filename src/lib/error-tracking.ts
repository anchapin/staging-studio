import { NextRequest } from "next/server";
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
 * the caller's control flow.
 */
export function trackError(error: unknown, context: ErrorContext = {}): void {
  const errorType = classifyErrorType(error);
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

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
}

/**
 * Wraps a Next.js Route Handler and:
 * 1. Logs any unhandled error with full ErrorContext.
 * 2. Returns a consistent JSON error response.
 *
 * This does NOT replace withErrorHandler from api-error-handler.ts — it
 * supplements it by adding structured logging on top.
 */
export function createErrorHandler(
  handler: (request: NextRequest, ...args: unknown[]) => Promise<Response>
) {
  return async (request: NextRequest | undefined, ...args: unknown[]): Promise<Response> => {
    try {
      return await handler(request as NextRequest, ...args);
    } catch (error) {
      const requestId = request?.headers.get("x-request-id") ?? undefined;
      const sessionId = request?.cookies.get("sb-access-token")?.value ?? undefined;
      const path = request ? new URL(request.url).pathname : "(unknown)";
      const method = request ? request.method : "(unknown)";

      trackError(error, { requestId, sessionId, path, method });

      // Re-throw so api-error-handler or the route's own catch can format the response
      throw error;
    }
  };
}

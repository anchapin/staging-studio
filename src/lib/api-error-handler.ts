import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  API_ERROR_INTERNAL_SERVER,
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_PROJECT_OWNERSHIP_DENIED,
} from "@/lib/api-errors";

/**
 * Standardized API error shape returned by all wrapped route handlers.
 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Custom error class for API-level errors.
 * Throwing an ApiError (instead of returning a raw NextResponse) allows
 * withErrorHandler to intercept and format it consistently.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly status: number;

  constructor(params: {
    code: string;
    message: string;
    status?: number;
    details?: unknown;
  }) {
    super(params.message);
    this.name = "ApiError";
    this.code = params.code;
    this.status = params.status ?? 500;
    this.details = params.details;
  }
}

/**
 * Thrown when a user attempts to access a project they do not own.
 * Maps to HTTP 403 Forbidden.
 */
export class ProjectOwnershipError extends ApiError {
  constructor(projectId: string) {
    super({
      code: API_ERROR_PROJECT_OWNERSHIP_DENIED,
      message: `Access denied: you do not own project "${projectId}"`,
      status: 403,
      details: { projectId },
    });
    this.name = "ProjectOwnershipError";
  }
}

/**
 * Classifies a raw thrown error into an ApiError shape, mapping known error
 * types (Zod, rate limits, auth, integration failures) to their canonical
 * error code + HTTP status.
 */
function classifyError(error: unknown): {
  code: string;
  message: string;
  status: number;
  details?: unknown;
} {
  // Zod validation errors
  if (error instanceof ZodError) {
    return {
      code: API_ERROR_INVALID_REQUEST,
      message: "Validation failed",
      status: 400,
      details: error.issues,
    };
  }

  // ApiError — already fully classified by the thrower
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details,
    };
  }

  // Rate limit headers (429)
  if (
    error instanceof Error &&
    (error.message.includes("rate limit") ||
      error.message.includes("429") ||
      error.message.includes("Too Many Requests"))
  ) {
    return {
      code: API_ERROR_RATE_LIMIT_EXCEEDED,
      message: "Too many requests. Please slow down and try again.",
      status: 429,
    };
  }

  // Integration / external-service errors (classifyIntegrationError sets a
  // "code" property on the error)
  if (error instanceof Error && "code" in error) {
    const code = (error as Record<string, unknown>).code;
    if (typeof code === "string" && code.startsWith("api_error_")) {
      return {
        code,
        message: error.message,
        status: getStatusForCode(code),
      };
    }
  }

  // Generic server error for unknown errors — sanitized message (never expose internal details)
  return {
    code: API_ERROR_INTERNAL_SERVER,
    message: "An unexpected error occurred",
    status: 500,
  };
}

function getStatusForCode(code: string): number {
  if (code.includes("unauthorized") || code.includes("invalid-token")) return 401;
  if (code.includes("not-found")) return 404;
  if (code.includes("invalid-request") || code.includes("validation")) return 400;
  if (code.includes("rate-limit") || code.includes("too-many")) return 429;
  if (code.includes("external-service") || code.includes("integration")) return 502;
  return 500;
}

/**
 * Wraps a Next.js Route Handler and catches any unhandled error that escapes
 * the handler's own try/catch, returning a consistent structured JSON response:
 *   { error: { code, message, details? } }
 *
 * Usage:
 *   export const POST = withErrorHandler(async (request: NextRequest) => {
 *     // ... handler body
 *   });
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withErrorHandler(handler: (request: NextRequest, ...args: any[]) => Promise<Response>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (request: NextRequest | undefined, ...args: any[]): Promise<Response> => {
    try {
      return await handler(request as NextRequest, ...args);
    } catch (error) {
      const path = request ? new URL(request.url).pathname : "(unknown)";
      const method = request ? request.method : "(unknown)";
      const classified = classifyError(error);

      // Log the full error for debugging; for unknown errors, always log
      if (classified.code === API_ERROR_INTERNAL_SERVER || !(error instanceof ApiError)) {
        console.error(
          JSON.stringify({
            event: "unhandled_route_error",
            path,
            method,
            error: error instanceof Error ? error.message : String(error),
          }),
          error
        );
      }

      const response: ApiErrorResponse = {
        error: {
          code: classified.code,
          message: classified.message,
          ...(classified.details !== undefined && { details: classified.details }),
        },
      };

      return NextResponse.json(response, { status: classified.status });
    }
  };
}

import { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { trackError } from "@/lib/error-tracking";

/**
 * Middleware-style request logger that logs method, path, status, and duration.
 * Attach to API routes via the `withRequestLogging` wrapper.
 */
export function withRequestLogging(
  handler: (request: NextRequest) => Promise<Response>
): (request: NextRequest) => Promise<Response> {
  return async (request: NextRequest): Promise<Response> => {
    const start = Date.now();
    const method = request.method;
    const path = new URL(request.url).pathname;
    const requestId = request.headers.get("x-request-id") ?? undefined;

    try {
      const response = await handler(request);
      const duration = Date.now() - start;

      logger.info({
        event: "http_request",
        method,
        path,
        status: response.status,
        duration_ms: duration,
        requestId,
      });

      return response;
    } catch (error) {
      const duration = Date.now() - start;

      trackError(error, { requestId, path, method });

      logger.info({
        event: "http_request",
        method,
        path,
        status: 500,
        duration_ms: duration,
        requestId,
      });

      throw error;
    }
  };
}

/**
 * Wraps a server action and logs any errors that escape it, attaching
 * the provided context to the structured log entry.
 */
export function withActionLogging<T extends (...args: unknown[]) => unknown>(
  action: T,
  context: Record<string, unknown> = {}
): T {
  return ((...args: unknown[]) => {
    try {
      return (action as (...args: unknown[]) => unknown)(...args);
    } catch (error) {
      trackError(error, context);
      throw error;
    }
  }) as T;
}

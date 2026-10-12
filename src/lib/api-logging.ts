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
    // Defensive parse: a request double with a non-absolute URL (some test
    // harnesses build one) must not derail the route it wraps; the log
    // entry just loses its path.
    let path: string;
    try {
      path = new URL(request.url).pathname;
    } catch {
      path = "(unparsed)";
    }
    // Issue #1116: read OR GENERATE the request id. A caller-supplied
    // x-request-id joins the serverless hops that echo it; with none, this
    // mints one so every invocation is still correlatable.
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

    try {
      const response = await handler(request);
      const duration = Date.now() - start;

      // A route may override the id on its response (the inpaint submit
      // echoes the pipeline requestId, which supersedes the minted one).
      // Echo and log whichever id the response carries so the http_request
      // entry joins the same hop chain the client sees.
      const echoedId = response.headers.get("x-request-id") ?? requestId;
      if (!response.headers.has("x-request-id")) {
        response.headers.set("x-request-id", echoedId);
      }

      logger.info({
        event: "http_request",
        method,
        path,
        status: response.status,
        duration_ms: duration,
        requestId: echoedId,
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

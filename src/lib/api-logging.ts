/**
 * API route request logging helper.
 *
 * Use withRouteLogging in your route.ts handlers to automatically:
 * 1. Log the incoming request (method, path, requestId)
 * 2. Time the handler execution
 * 3. Log the response (status, duration)
 * 4. Log any errors that escape the handler with full context
 *
 * Usage:
 *   import { withRouteLogging } from "@/lib/api-logging";
 *
 *   export async function GET(req: Request) {
 *     const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
 *     return withRouteLogging({ requestId }, req, async () => {
 *       // ... your handler code
 *     });
 *   }
 */

import { requestLogger } from "@/lib/logger";
import { trackError } from "@/lib/error-tracking";
import type { ErrorContext } from "@/lib/error-tracking";

interface RouteLoggingOptions {
  /** Request ID from headers (x-request-id or similar) */
  requestId: string;
  /** User ID if authenticated */
  userId?: string | null;
  /** Extra context fields */
  extra?: Record<string, unknown>;
}

/**
 * Wraps an API route handler with structured request/response logging.
 * Returns the handler's response normally so Next.js route semantics are unchanged.
 */
export async function withRouteLogging<T>(
  options: RouteLoggingOptions,
  request: Request,
  handler: () => Promise<T>
): Promise<T> {
  const { requestId, userId, extra } = options;
  const log = requestLogger(requestId, {
    method: request.method,
    path: new URL(request.url).pathname,
    userId: userId ?? null,
    ...extra,
  });

  const start = performance.now();

  log.info({ type: "request_start" }, `--> ${request.method} ${request.url.pathname}`);

  try {
    const result = await handler();
    const durationMs = performance.now() - start;

    log.info(
      { type: "request_end", durationMs, status: 200 },
      `<-- ${request.method} ${request.url.pathname} 200 (${durationMs.toFixed(1)}ms)`
    );

    return result;
  } catch (err) {
    const durationMs = performance.now() - start;
    const status = err instanceof Error ? (err as { status?: number }).status ?? 500 : 500;

    trackError(err, {
      userId,
      requestId,
      action: `${request.method} ${new URL(request.url).pathname}`,
    });

    log.error(
      { type: "request_error", durationMs, status },
      `<-- ${request.method} ${new URL(request.url).pathname} ${status} (${durationMs.toFixed(1)}ms)`
    );

    throw err;
  }
}

/**
 * Convenience wrapper for Next.js App Router route handlers that receive
 * `request: Request` as the first arg. Extracts requestId from headers.
 *
 * Usage:
 *   export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
 *     return withNextRouteLogging(req, async () => {
 *       const { id } = await params;
 *       return Response.json({ id });
 *     });
 *   }
 */
export async function withNextRouteLogging<T>(
  request: Request,
  userId: string | null | undefined,
  handler: () => Promise<T>
): Promise<T> {
  const requestId =
    request.headers.get("x-request-id") ??
    request.headers.get("x-vercel-id") ?? // Vercel injects this
    crypto.randomUUID();

  return withRouteLogging({ requestId, userId }, request, handler);
}

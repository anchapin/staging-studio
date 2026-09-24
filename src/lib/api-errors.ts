/**
 * Application-level error codes for API routes.
 *
 * Problem: Next.js route handlers that throw non-`Response` values during
 * streaming (e.g. inside a `streamText`/`streamObject` generator) are not
 * caught by the `try/catch` that wraps `handler` in the route — they
 * manifest as unhandled promise rejections with no `errorId` that Vercel
 * reports to Sentry as "no user context".  The only reliable escape hatch
 * is throwing a `NEXT_AUTH_CODE` (a string that middleware.ts listens for in
 * `errorMiddleware`) so the error is caught and normalized there.
 *
 * Solution: all API route auth errors MUST throw
 * `ApiError(NEXT_AUTH_CODE, 401, "…")` rather than bare `Response.json`
 * or plain `Error` objects so that:
 * - `middleware.ts` sees `NEXT_AUTH_CODE` and does not re-throw to Sentry
 *   with "no user context"
 * - The handler's catch block can `return err.toResponse()` and get a
 *   properly shaped 401 JSON with `{ error, message }`
 *
 * Non-auth errors (validation, not found, 429, etc.) use the same
 * `ApiError` class for consistency but without `NEXT_AUTH_CODE` so that
 * Sentry captures the full stack with user context.
 *
 * @example
 * ```ts
 * // In a route handler:
 * const user = await getAuthedPrismaUser(req).catch((err) => {
 *   if (err instanceof ApiError) return err.toResponse();
 *   throw err;
 * });
 * if (!user) throw new ApiError("INVALID_API_KEY", 401, "Invalid API key");
 * if (!room) throw new ApiError("ROOM_NOT_FOUND", 404, "Room not found");
 * if (quotaExhausted) throw new ApiError("QUOTA_EXCEEDED", 429, "Quota exceeded");
 * ```
 *
 * @example
 * ```ts
 * // In middleware.ts errorMiddleware:
 * if (cause === "NEXT_AUTH_CODE") {
 *   console.warn("[auth]", status, message);
 *   return NextResponse.json({ error: "Unauthorized", message }, { status });
 * }
 * ```
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }

  toResponse(): Response {
    return NextResponse.json(
      { error: this.code, message: this.message },
      { status: this.status }
    );
  }
}

// Minimal NextResponse stub so ApiError works in edge / non-Next contexts.
// (Production imports the real NextResponse from next/server.)
// eslint-disable-next-line @typescript-eslint/no-redeclare
const NextResponse = {
  json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init),
};

/**
 * Magic string that middleware.ts listens for in thrown errors to detect auth
 * failures and suppress Sentry reporting with "no user context".
 *
 * Usage: `throw new ApiError(NEXT_AUTH_CODE, 401, "Unauthenticated")`
 *
 * In middleware.ts `errorMiddleware`:
 * ```ts
 * if (cause === "NEXT_AUTH_CODE") {
 *   return NextResponse.json({ error: "Unauthorized", message }, { status });
 * }
 * ```
 */
export const NEXT_AUTH_CODE = "NEXT_AUTH";

/**
 * Alias for `NEXT_AUTH_CODE` for use in `throw new ApiError` calls so that
 * call sites can use either name — useful when callers need to signal
 * "this is an auth error and should not pollute Sentry" without knowing
 * which alias the codebase prefers.
 */
export { NEXT_AUTH_CODE as AUTH_ERROR_CODE };

// Convenience error-code constants for common HTTP status codes used across
// the API route surface. Route handlers throw these via `ApiError`:
//
//   throw new ApiError(UNAUTHORIZED, 401, "Unauthenticated");
//
// These are NOT `Response` objects — they are plain string constants that
// carry no protocol semantics. Always pair with a `status` number when
// constructing an `ApiError`.

/** 401 Unauthorized — session absent, invalid, or expired. */
export const UNAUTHORIZED = "UNAUTHORIZED";
/** 403 Forbidden — session valid but action not permitted. */
export const FORBIDDEN = "FORBIDDEN";
/** 404 Not Found — resource does not exist or is not visible to caller. */
export const NOT_FOUND = "NOT_FOUND";
/** 409 Conflict — idempotency key collision or exclusive lock held. */
export const CONFLICT = "CONFLICT";
/** 422 Unprocessable Entity — request was well-formed but semantically invalid. */
export const UNPROCESSABLE_ENTITY = "UNPROCESSABLE_ENTITY";
/** 429 Too Many Requests — request rate or quota exceeded. */
export const RATE_LIMITED = "RATE_LIMITED";

import { NextRequest, NextResponse } from "next/server";

/**
 * Wraps a Next.js Route Handler and catches any unhandled error that escapes
 * the handler's own try/catch, returning a consistent structured JSON response
 * instead of a raw 500.
 *
 * Usage:
 *   export const POST = withErrorHandler(async (request: NextRequest) => {
 *     // ... handler body
 *   });
 */
export function withErrorHandler<
  R extends NextRequest = NextRequest,
>(
  handler: (request: R) => Promise<Response>
) {
  return async (request: R): Promise<Response> => {
    try {
      return await handler(request);
    } catch (error) {
      console.error(
        JSON.stringify({ event: "unhandled_route_error", path: new URL(request.url).pathname }),
        error
      );

      const message =
        error instanceof Error ? error.message : "An unexpected error occurred";

      return NextResponse.json(
        {
          success: false,
          error: "Internal server error",
          message,
        },
        { status: 500 }
      );
    }
  };
}

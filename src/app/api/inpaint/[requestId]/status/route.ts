import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { ApiError } from "@/lib/api-error-handler";
import { buildDeprecationHeaders } from "@/lib/api-version";
import {
  INPAINT_STATUS_RATE_LIMIT,
  checkInpaintStatusRateLimit,
  INPAINT_TERMINAL_ERROR_BODY,
  pollFalStatus,
  validateInpaintRequestOwnership,
  classifyStatusError,
} from "@/lib/inpaint-status";
import {
  API_ERROR_TOO_MANY_REQUESTS,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_REQUEST_NOT_FOUND,
} from "@/lib/api-errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  let requestId: string | undefined;

  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "You must be signed in to check inpainting status.",
          code: error.code,
        },
        { status: 401, headers: buildDeprecationHeaders() }
      );
    }
    throw error;
  }

  try {
    const { requestId: requestIdParam } = await params;
    requestId = requestIdParam;

    if (!requestId) {
      return NextResponse.json(
        { error: "Missing requestId", message: "Request ID is required to check status", code: API_ERROR_INVALID_REQUEST },
        { status: 400 }
      );
    }

    const rateLimit = checkInpaintStatusRateLimit(user.id, requestId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Too many requests",
          message: `Rate limit exceeded. Please wait ${rateLimit.retryAfterSeconds} seconds before trying again.`,
          code: API_ERROR_TOO_MANY_REQUESTS,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
            "X-RateLimit-Limit": String(INPAINT_STATUS_RATE_LIMIT),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const identity = await validateInpaintRequestOwnership(requestId, user.id);
    if (!identity) {
      return NextResponse.json(
        { error: "Request not found", message: "This image processing request could not be found or you don't have access to it.", code: API_ERROR_REQUEST_NOT_FOUND },
        { status: 404 }
      );
    }

    const result = await pollFalStatus(requestId);

    if (result.status === "ERROR") {
      return NextResponse.json(INPAINT_TERMINAL_ERROR_BODY, { status: 500 });
    }

    return NextResponse.json({
      status: result.status,
      imageUrl: result.imageUrl ?? undefined,
      ...(result.persisted !== undefined ? { persisted: result.persisted } : {}),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "inpaint_status_failed", requestId: requestId ?? null }), error);
    const classified = classifyStatusError(error);
    return NextResponse.json(
      { error: classified.error, message: classified.message, retryable: classified.retryable, code: classified.code },
      { status: classified.status }
    );
  }
}

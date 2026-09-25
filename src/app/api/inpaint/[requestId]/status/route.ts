import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { buildDeprecationHeaders } from "@/lib/api-version";
import { decideInpaintPersistence } from "@/lib/inpaint-persistence";
import { classifyIntegrationError } from "@/lib/error-classify";
import { FAL_FLUX_FILL_MODEL } from "@/lib/prompts";
import {
  INPAINT_STATUS_RATE_LIMIT,
  checkInpaintStatusRateLimit,
  INPAINT_TERMINAL_ERROR_BODY,
  pollFalStatus,
  validateInpaintRequestOwnership,
  classifyStatusError,
} from "@/lib/inpaint-status";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_TOO_MANY_REQUESTS,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_REQUEST_NOT_FOUND,
} from "@/lib/api-errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  let requestId: string | undefined;

  try {
    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "You must be signed in to check inpainting status.",
          code: API_ERROR_UNAUTHORIZED,
        },
        { status: 401, headers: buildDeprecationHeaders() }
      );
    }

    const rateLimit = checkInpaintStatusRateLimit(user.id);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Too many requests",
          message: `Rate limit exceeded. Please wait ${rateLimit.retryAfterMs} seconds before trying again.`,
          code: API_ERROR_TOO_MANY_REQUESTS,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterMs),
            "X-RateLimit-Limit": String(INPAINT_STATUS_RATE_LIMIT),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const { requestId: requestIdParam } = await params;
    requestId = requestIdParam;

    if (!requestId) {
      return NextResponse.json(
        { error: "Missing requestId", message: "Request ID is required to check status", code: API_ERROR_INVALID_REQUEST },
        { status: 400 }
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

import { NextRequest, NextResponse } from "next/server";

import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_ROOM_NOT_FOUND,
  API_ERROR_SAVE_FAILED,
  API_ERROR_COPY_GENERATION_FAILED,
  API_ERROR_MISSING_REQUIRED_FIELDS,
} from "@/lib/api-errors";
import { withRequestLogging } from "@/lib/api-logging";
import { classifyIntegrationError } from "@/lib/error-classify";
import { logger } from "@/lib/logger";
import { runGenerateCopy } from "@/lib/generate-copy-service";

/**
 * Unversioned POST /api/generate-copy.
 *
 * Wave-5 revival (issue #1389): the orchestration (auth, body parse,
 * room/project fetch, directives check, quota claim, OpenAI call with
 * failover, advisory quality gate, persist, refund on paid-call failure)
 * lives in `src/lib/generate-copy-service.ts`. This handler only maps
 * the discriminated result to the route's pinned HTTP shape:
 *
 * - `{ success: true, data, finishReason, usage, model, qualityWarnings }`
 *   on `success` (200).
 * - `{ success: false, error, message, code }` on every other arm,
 *   with status codes preserved by the route (400, 401, 403, 404, 429,
 *   500, 502, 503).
 * - `saveFailed` is a 502 — the copy is in hand but not on disk; the
 *   route returns the copy alongside the `saveFailed` marker so the
 *   client can retry persistence (#1132 + #1124 spirit: the unit
 *   stays claimed).
 *
 * Refund policy diverges from PR-3's export-pdf service (#1124 keeps
 * the claim on dispatch failure; here #1132 refunds on paid-call
 * failure but keeps the claim on a post-paid-call `saveFailed`).
 * Documented at the top of the service file.
 */

// OpenAI generation + DB writes comfortably fit under 60s.
export const maxDuration = 60;

const GENERATE_COPY_ERROR_COPY = {
  auth: {
    error: "Authentication failed",
    message: "The AI service authentication failed. Please contact support.",
    code: API_ERROR_COPY_GENERATION_FAILED,
  },
  timeout: {
    error: "Generation timed out",
    message: "The AI took too long to generate copy. Please try again.",
    code: API_ERROR_COPY_GENERATION_FAILED,
  },
  network: {
    error: "Network error",
    message: "Unable to reach the AI service. Please check your connection and try again.",
    code: API_ERROR_COPY_GENERATION_FAILED,
  },
  unknown: {
    error: "Generation failed",
    message: "We couldn't generate the staging copy. Please try again.",
    code: API_ERROR_COPY_GENERATION_FAILED,
  },
};

async function postGenerateCopy(req: NextRequest) {
  let bodyText = "";
  try {
    bodyText = await req.text();
    const result = await runGenerateCopy({ bodyText });

    switch (result.kind) {
      case "unauthorized":
        return NextResponse.json(
          {
            success: false,
            error: "Unauthorized",
            message: "You must be signed in to generate copy.",
            code: API_ERROR_UNAUTHORIZED,
          },
          { status: 401 }
        );

      case "invalidRequest":
        return NextResponse.json(
          {
            success: false,
            error: "Invalid request",
            message: result.message,
            code: API_ERROR_INVALID_REQUEST,
          },
          { status: 400 }
        );

      case "roomNotFound":
        return NextResponse.json(
          {
            success: false,
            error: "Room not found",
            message: "Room not found.",
            code: API_ERROR_ROOM_NOT_FOUND,
          },
          { status: 404 }
        );

      case "projectNotFound":
        return NextResponse.json(
          {
            success: false,
            error: "Project not found",
            message: "Project not found or no longer accessible.",
            code: API_ERROR_INVALID_REQUEST,
          },
          { status: 404 }
        );

      case "projectForbidden":
        return NextResponse.json(
          {
            success: false,
            error: "Forbidden",
            message: "You do not have access to this room's project.",
            code: API_ERROR_INVALID_REQUEST,
          },
          { status: 403 }
        );

      case "missingDirectives":
        return NextResponse.json(
          {
            success: false,
            error: "Missing staging directives",
            message:
              "Add staging directives for this room before generating copy.",
            code: API_ERROR_MISSING_REQUIRED_FIELDS,
          },
          { status: 400 }
        );

      case "quotaExceeded":
        return NextResponse.json(
          {
            success: false,
            ...result.payload,
            code: API_ERROR_RATE_LIMIT_EXCEEDED,
          },
          { status: 429 }
        );

      case "saveFailed":
        // Issue #1132: the unit stays claimed when the paid call resolved
        // but persistence failed. The client retries persistence; if it
        // doesn't, the daily cap holds. The original route distinguished
        // this from a fresh generation failure with `error: "save_failed"`
        // + `retryable: true` + `copy: generatedCopy` so the client can
        // retry save-only instead of paying to regenerate.
        logger.warn(
          {
            event: "generate_copy_save_failed",
            message: result.saveError ?? "save failed",
          },
          "saveRoomCopy returned success: false"
        );
        return NextResponse.json(
          {
            success: false,
            error: "save_failed",
            message: "Copy was generated but could not be saved. Please try again.",
            retryable: true,
            copy: result.generatedCopy,
            qualityWarnings: result.qualityWarnings,
            code: API_ERROR_SAVE_FAILED,
          },
          { status: 502 }
        );

      case "success":
        return NextResponse.json(
          {
            success: true,
            data: result.generatedCopy,
            finishReason: result.finishReason,
            usage: result.usage,
            model: result.model,
            qualityWarnings: result.qualityWarnings,
            failedOver: result.failedOver,
          },
          { status: 200 }
        );
    }
  } catch (error) {
    // The service is responsible for refunding on paid-call failure
    // (#1132) before this catch runs. We only classify unmapped errors
    // (e.g. a DB or circuit-breaker failure after the unit was kept).
    // The service is responsible for refunding on paid-call failure
    // (#1132) before this catch runs. We only classify unmapped errors
    // (e.g. a DB or circuit-breaker failure after the unit was kept).
    console.error(
      JSON.stringify({
        event: "generate_copy_failed",
        bodyLength: bodyText.length,
      }),
      error
    );

    const classified = classifyIntegrationError(
      error,
      GENERATE_COPY_ERROR_COPY,
    );
    // Surface the daily-limit status code if the classifier recognized
    // the OpenAI rate-limit signal (#201).
    const status =
      classified.code === API_ERROR_RATE_LIMIT_EXCEEDED
        ? 429
        : classified.status;
    return NextResponse.json(
      {
        success: false,
        error: classified.error,
        message: classified.message,
        retryable: classified.retryable,
        code: classified.code,
      },
      { status }
    );
  }
}

export const POST = withRequestLogging(postGenerateCopy);
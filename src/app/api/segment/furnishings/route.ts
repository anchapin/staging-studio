import { NextRequest, NextResponse } from "next/server";

import { ApiError } from "@/lib/api-error-handler";
import { furnishingsSegmentRequestSchema } from "@/lib/ai-route-schemas";
import {
  API_ERROR_INVALID_CONCEPT,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_ROOM_NOT_FOUND,
  API_ERROR_UNAUTHORIZED,
} from "@/lib/api-errors";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { buildDeprecationHeaders } from "@/lib/api-version";
import {
  claimDailyQuota,
  dailyQuotaExceededPayload,
  DEFAULT_DAILY_SEGMENT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  refundDailyQuota,
  resolveDailyLimit,
} from "@/lib/api-quota";
import { classifyIntegrationError } from "@/lib/error-classify";
import { DETECTION_TIMEOUT_MS } from "@/lib/segment-timeouts";
import {
  defaultSegmentFurnishingsServiceDeps,
  runFurnishingDetection,
  validateSegmentAccess,
} from "@/lib/segment-furnishings-service";
import type { QuotaClaim } from "@/lib/api-quota";

// Issue #227: a concept that fails validation is the caller's mistake,
// never a transient provider state — the client should let the user fix
// the input, not auto-retry the same body.
const INVALID_CONCEPT_COPY = {
  error: "Invalid concept",
  message:
    'Use a single lowercase word or short phrase — 1–30 characters, lowercase letters, spaces, and hyphens only (no commas or sentences). Try "sofa", "wall art", or leave the concept off for the default "furniture".',
};

export const INVALID_FURNISHINGS_REQUEST_MESSAGE =
  "We couldn't read the room details — try reloading the room.";

export const FURNISHINGS_ERROR_COPY = {
  auth: {
    error: "Authentication failed",
    message:
      "We couldn't reach the staging service — please try again in a moment.",
  },
  timeout: {
    error: "Request timeout",
    message:
      "The furnishings detection service is taking too long to respond. Please try again.",
  },
  unknown: {
    error: "Furnishings detection failed",
    message:
      "We couldn't detect furnishings in this photo. Please try again or use the brush tools.",
  },
};

/**
 * Issue #1118: this route's worst case is the fal subscribe bounded by
 * DETECTION_TIMEOUT_MS followed — sequentially — by the mask fetches,
 * each armed with a fresh timeout of the same length. Without this
 * declaration the platform default kills the function before either
 * internal timeout fires, so the caller gets an opaque 504/500 instead
 * of the classified "Request timeout" copy and `recordDailyUsage` never
 * runs, leaving the paid SAM call unbilled.
 */
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  let roomId: string | undefined;
  let segmentUserId: string | undefined;
  let segmentClaim: QuotaClaim | null = null;
  try {
    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "You must be signed in to detect furnishings.",
          code: API_ERROR_UNAUTHORIZED,
        },
        { status: 401, headers: buildDeprecationHeaders() },
      );
    }

    const parsed = furnishingsSegmentRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      segmentUserId = user.id;
      const conceptInvalid = parsed.error.issues.some((issue) =>
        issue.path.includes("concept"),
      );
      return NextResponse.json(
        {
          error: conceptInvalid ? INVALID_CONCEPT_COPY.error : "Invalid request",
          message: conceptInvalid
            ? INVALID_CONCEPT_COPY.message
            : INVALID_FURNISHINGS_REQUEST_MESSAGE,
          retryable: false,
          issues: parsed.error.issues,
          code: conceptInvalid ? API_ERROR_INVALID_CONCEPT : API_ERROR_INVALID_REQUEST,
        },
        { status: 400 },
      );
    }

    const { imageUrl, concept } = parsed.data;
    roomId = parsed.data.roomId;

    const deps = defaultSegmentFurnishingsServiceDeps();
    await validateSegmentAccess({ roomId }, user, deps);

    // Issue #226/#1132: claim one segment unit ATOMICALLY here, on the
    // eve of the paid call, instead of gate-reading the counter up front.
    segmentClaim = await claimDailyQuota(
      "segment",
      user.id,
      resolveDailyLimit(
        process.env[DAILY_LIMIT_ENV_VAR.segment],
        DEFAULT_DAILY_SEGMENT_LIMIT,
      ),
    );
    if (!segmentClaim.claimed) {
      console.warn(
        JSON.stringify({
          event: "segment_daily_quota_exceeded",
          userId: user.id,
          used: segmentClaim.used,
          limit: segmentClaim.limit,
        }),
      );
      return NextResponse.json(
        {
          ...dailyQuotaExceededPayload(segmentClaim, "Please try again tomorrow."),
          code: API_ERROR_RATE_LIMIT_EXCEEDED,
        },
        { status: 429 },
      );
    }

    const detection = await runFurnishingDetection(
      {
        imageUrl,
        ...(concept !== undefined ? { concept } : {}),
        abortSignal: AbortSignal.timeout(DETECTION_TIMEOUT_MS),
      },
      {
        ...deps,
        // Override `fetch` with the timeout-aware variant — the route owns
        // the per-request deadline, not the service.
        fetch: async (url: string) =>
          fetch(url, { signal: AbortSignal.timeout(DETECTION_TIMEOUT_MS) }),
      },
    );

    // Every mask failing is indistinguishable from a broken detection,
    // so it takes the classified error path rather than presenting as
    // "no furnishings found".
    if (detection.maskUrls.length > 0 && detection.masks.length === 0) {
      throw new Error("Every detected mask image failed to download");
    }

    if (detection.masks.length < detection.maskUrls.length) {
      console.warn(
        JSON.stringify({
          event: "furnishings_mask_fetch_partial",
          roomId: roomId ?? null,
          requested: detection.maskUrls.length,
          fetched: detection.masks.length,
        }),
      );
    }

    return NextResponse.json({
      concept,
      maskDataUrls: detection.masks,
      // `keptScores` is the inference `scores` array filtered to the
      // surviving (fulfilled) masks. `undefined` when the inference
      // response carried no scores — keep that contract for the client.
      scores: detection.keptScores,
    });
  } catch (error) {
    if (segmentUserId && segmentClaim?.claimed) {
      await refundDailyQuota("segment", segmentUserId);
    }
    console.error(
      JSON.stringify({ event: "furnishings_detection_failed", roomId: roomId ?? null }),
      error,
    );

    const classified = classifyIntegrationError(error, FURNISHINGS_ERROR_COPY);

    return NextResponse.json(
      {
        error: classified.error,
        message: classified.message,
        retryable: classified.retryable,
        code: classified.code,
      },
      { status: classified.status },
    );
  }
}
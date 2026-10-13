import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { buildDeprecationHeaders } from "@/lib/api-version";
import { furnishingsSegmentRequestSchema } from "@/lib/ai-route-schemas";
import { classifyIntegrationError } from "@/lib/error-classify";
import { getInferenceClient, LOGICAL_MODEL, assertInferenceConfigured } from "@/lib/inference";
import {
  DEFAULT_DAILY_SEGMENT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  claimDailyQuota,
  refundDailyQuota,
  resolveDailyLimit,
} from "@/lib/api-quota";
import type { QuotaClaim } from "@/lib/api-quota";
import {
  buildFurnishingDetectionPayload,
  parseFurnishingDetectionResponse,
} from "@/lib/furnishing-detection";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_INVALID_CONCEPT,
  API_ERROR_ROOM_NOT_FOUND,
} from "@/lib/api-errors";
import { DETECTION_TIMEOUT_MS } from "@/lib/segment-timeouts";

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

// Detection returns per-object mask images; a ceiling this generous only
// trips on provider misbehavior, never on real masks.
const MAX_MASK_RESPONSE_BYTES = 10 * 1024 * 1024;

// Issue #227: a concept that fails validation is the caller's mistake,
// never a transient provider state — the client should let the user fix
// the input, not auto-retry the same body.
const INVALID_CONCEPT_COPY = {
  error: "Invalid concept",
  message:
    'Use a single lowercase word or short phrase — 1–30 characters, lowercase letters, spaces, and hyphens only (no commas or sentences). Try "sofa", "wall art", or leave the concept off for the default "furniture".',
};

// SAM 3.1 detection completes in seconds; bound the wait so a hung
// provider degrades to the retryable timeout copy instead of hanging
// the detection request.

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

/**
 * Fetches a fal-hosted mask image and re-encodes it as a data URL so the
 * browser can composite it without a cross-origin image load (which
 * would depend on remote CORS headers and could taint the canvas).
 * Side effects: performs one outbound HTTP fetch; throws on non-image
 * or oversized responses so the caller's catch block classifies the
 * failure.
 */
async function fetchMaskAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DETECTION_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Mask image request failed with HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error("Mask image response has an unexpected content type");
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_MASK_RESPONSE_BYTES) {
    throw new Error("Mask image response is unexpectedly large");
  }
  const base64 = Buffer.from(buffer).toString("base64");
  const mime = contentType.split(";")[0].trim() || "image/png";
  return `data:${mime};base64,${base64}`;
}

export async function POST(request: NextRequest) {
  let roomId: string | undefined;
  // Issue #1132: per-request record of an atomic quota claim so the catch
  // below can refund it when detection fails.
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
        { status: 401, headers: buildDeprecationHeaders() }
      );
    }

    const parsed = furnishingsSegmentRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      segmentUserId = user.id;

    // Issue #227: concept-shaped failures get actionable, non-retryable
      // copy — the fix is editing the input, not resending it.
      const conceptInvalid = parsed.error.issues.some((issue) =>
        issue.path.includes("concept")
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
        { status: 400 }
      );
    }

    const { imageUrl, concept } = parsed.data;
    roomId = parsed.data.roomId;

    const room = await prisma.room.findFirst({
      where: { id: roomId, project: { userId: user.id } },
      select: { id: true },
    });
    if (!room) {
      return NextResponse.json(
        {
          error: "Room not found",
          message: "The requested room could not be found.",
          code: API_ERROR_ROOM_NOT_FOUND,
        },
        { status: 404 }
      );
    }

    assertInferenceConfigured();

    // Issue #226/#1132: claim one segment unit ATOMICALLY here, on the
    // eve of the paid call, instead of gate-reading the counter up front.
    // The conditional increment (UPDATE ... WHERE count <= limit - N) is
    // serialized by Postgres, so a concurrent burst can no longer all
    // read the same pre-spend count and all reach SAM 3.1; losers get 429
    // with the same payload shape as before. A failed detection refunds
    // the claim in the catch below, so net accounting is unchanged.
    segmentClaim = await claimDailyQuota(
      "segment",
      user.id,
      resolveDailyLimit(
        process.env[DAILY_LIMIT_ENV_VAR.segment],
        DEFAULT_DAILY_SEGMENT_LIMIT
      )
    );
    if (!segmentClaim.claimed) {
      console.warn(
        JSON.stringify({
          event: "segment_daily_quota_exceeded",
          userId: user.id,
          used: segmentClaim.used,
          limit: segmentClaim.limit,
        })
      );
      return NextResponse.json(
        {
          ...dailyQuotaExceededPayload(segmentClaim, "Please try again tomorrow."),
          code: API_ERROR_RATE_LIMIT_EXCEEDED,
        },
        { status: 429 }
      );
    }

    // Synchronous detection call: SAM 3.1 completes in seconds, so a
    // direct queue-aware subscribe keeps the preset flow
    // single-round-trip (the same pattern as /api/segment). Omitted
    // concept ⇒ the payload builder applies the verified "furniture"
    // default, so the preset path stays byte-equivalent. The active
    // provider (fal by default; Replicate when
    // INFERENCE_PROVIDER=replicate) is resolved here once per
    // request and the subscribe goes through the abstraction.
    const payload = buildFurnishingDetectionPayload({ imageUrl, concept });
    const inference = await getInferenceClient();
    const result = await inference.subscribe(LOGICAL_MODEL.SAM_3_1_IMAGE, {
      input: payload,
      abortSignal: AbortSignal.timeout(DETECTION_TIMEOUT_MS),
    });

    const detection = parseFurnishingDetectionResponse(result);
    if (!detection) {
      throw new Error("Detection response did not include mask images");
    }

    // Issue #1119: settle per mask. `Promise.all` rejected the whole
    // batch when a single mask URL was slow or 5xx, so the user got
    // ZERO regions after an already-billed SAM call — auto-detect
    // dead-ends on one bad URL. The classified error path is taken only
    // when every mask fails, matching the failure tolerance the inpaint
    // path already has (`persistInpaintImage` returns `{persisted:false}`
    // and the status route retries).
    const settled = await Promise.allSettled(
      detection.maskUrls.map((maskUrl) => fetchMaskAsDataUrl(maskUrl))
    );

    const maskDataUrls: string[] = [];
    const keptScores: number[] = [];
    let failedMaskCount = 0;

    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") {
        maskDataUrls.push(outcome.value);
        const score = detection.scores?.[index];
        if (score !== undefined) keptScores.push(score);
        return;
      }
      failedMaskCount += 1;
    });

    if (failedMaskCount > 0) {
      console.warn(
        JSON.stringify({
          event: "furnishings_mask_fetch_partial",
          roomId: roomId ?? null,
          requested: settled.length,
          failed: failedMaskCount,
        })
      );
    }

    // Every mask failing is indistinguishable from a broken detection,
    // so it takes the classified error path rather than presenting as
    // "no furnishings found".
    if (settled.length > 0 && maskDataUrls.length === 0) {
      throw new Error("Every detected mask image failed to download");
    }

    // An empty maskDataUrls list is a VALID result ("no {concept} found"
    // is presentable, not an error) — the response succeeds either way.
    // No charge is written here: the unit was claimed atomically before
    // the SAM call (issue #1132), and a failed detection is refunded in
    // the catch below, so only completed detections net-count, as before
    // (#720).

    return NextResponse.json({
      concept: payload.prompt,
      maskDataUrls,
      scores: detection.scores ? keptScores : detection.scores,
    });
  } catch (error) {
    // Issue #1132: give the claimed unit back when detection fails, so a
    // failed attempt costs the user nothing (the pre-#1132 behavior).
    if (segmentUserId && segmentClaim?.claimed) {
      await refundDailyQuota("segment", segmentUserId);
    }
    console.error(
      JSON.stringify({ event: "furnishings_detection_failed", roomId: roomId ?? null }),
      error
    );

    const classified = classifyIntegrationError(error, FURNISHINGS_ERROR_COPY);

    return NextResponse.json(
      {
        error: classified.error,
        message: classified.message,
        retryable: classified.retryable,
        code: classified.code,
      },
      { status: classified.status }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { fal, assertFalConfigured } from "@/lib/fal";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { furnishingsSegmentRequestSchema } from "@/lib/ai-route-schemas";
import { classifyIntegrationError } from "@/lib/error-classify";
import {
  DEFAULT_DAILY_SEGMENT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  evaluateDailyQuota,
  getDailyUsage,
  recordDailyUsage,
  resolveDailyLimit,
} from "@/lib/api-quota";
import {
  FAL_FURNISHING_DETECTION_MODEL,
  buildFurnishingDetectionPayload,
  parseFurnishingDetectionResponse,
} from "@/lib/furnishing-detection";

const FURNISHINGS_ERROR_COPY = {
  auth: {
    error: "Authentication failed",
    message:
      "Unable to connect to the furnishings detection service. Please check your configuration.",
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
const DETECTION_TIMEOUT_MS = 90_000;

type FalSubscribeFunction = (
  id: string,
  options: { input: Record<string, unknown>; abortSignal?: AbortSignal }
) => Promise<unknown>;

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
  try {
    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "You must be signed in to detect furnishings.",
        },
        { status: 401 }
      );
    }

    // Issue #226: daily per-user segment guardrail (in-process counter —
    // see lib/api-quota.ts for the mechanism and its multi-instance
    // limitation). Checked BEFORE the body is parsed so a user at their
    // cap never reaches the paid provider.
    const segmentLimit = resolveDailyLimit(
      process.env[DAILY_LIMIT_ENV_VAR.segment],
      DEFAULT_DAILY_SEGMENT_LIMIT
    );
    const segmentQuota = evaluateDailyQuota(
      getDailyUsage("segment", user.id),
      segmentLimit
    );
    if (!segmentQuota.allowed) {
      console.warn(
        JSON.stringify({
          event: "segment_daily_quota_exceeded",
          userId: user.id,
          used: segmentQuota.used,
          limit: segmentQuota.limit,
        })
      );
      return NextResponse.json(
        dailyQuotaExceededPayload(segmentQuota, "Please try again tomorrow."),
        { status: 429 }
      );
    }

    const parsed = furnishingsSegmentRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
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
            : "Please provide a valid roomId and imageUrl.",
          retryable: false,
          issues: parsed.error.issues,
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
        },
        { status: 404 }
      );
    }

    assertFalConfigured();

    // Synchronous detection call: SAM 3.1 completes in seconds, so a
    // direct queue-aware subscribe keeps the preset flow single-round-trip
    // (the same pattern as /api/segment). Omitted concept ⇒ the payload
    // builder applies the verified "furniture" default, so the preset
    // path stays byte-equivalent.
    const startedAtMs = Date.now();
    const falSubscribe = fal.subscribe as FalSubscribeFunction;
    const payload = buildFurnishingDetectionPayload({ imageUrl, concept });
    const result = await falSubscribe(FAL_FURNISHING_DETECTION_MODEL, {
      input: payload,
      abortSignal: AbortSignal.timeout(DETECTION_TIMEOUT_MS),
    });

    const detection = parseFurnishingDetectionResponse(result);
    if (!detection) {
      throw new Error("Detection response did not include mask images");
    }

    const maskDataUrls: string[] = [];
    for (const maskUrl of detection.maskUrls) {
      maskDataUrls.push(await fetchMaskAsDataUrl(maskUrl));
    }

    // An empty maskDataUrls list is a VALID result ("no {concept} found"
    // is presentable, not an error) — the response succeeds either way.
    // Billing and timing are logged only for completed detections.
    recordDailyUsage("segment", user.id);
    console.log(
      JSON.stringify({
        event: "segment_concept_timing",
        source: "network",
        concept: payload.prompt,
        instanceCount: maskDataUrls.length,
        ms: Date.now() - startedAtMs,
      })
    );

    return NextResponse.json({
      concept: payload.prompt,
      maskDataUrls,
      scores: detection.scores,
    });
  } catch (error) {
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
      },
      { status: classified.status }
    );
  }
}

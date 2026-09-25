import { NextRequest, NextResponse } from "next/server";
import { fal, assertFalConfigured } from "@/lib/fal";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { buildDeprecationHeaders } from "@/lib/api-version";
import { segmentRequestSchema } from "@/lib/ai-route-schemas";
import { classifyIntegrationError } from "@/lib/error-classify";
import {
  FAL_SAM_MODEL,
  buildFalSegmentPayload,
  parseFalSegmentResponse,
} from "@/lib/segment-mask";
import {
  buildSegmentServerTimingEvent,
  emitSegmentTiming,
} from "@/lib/segment-timing";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_ROOM_NOT_FOUND,
} from "@/lib/api-errors";

const SEGMENT_ERROR_COPY = {
  auth: {
    error: "Authentication failed",
    message:
      "Unable to connect to the object selection service. Please check your configuration.",
  },
  timeout: {
    error: "Request timeout",
    message: "The object selection service is taking too long to respond. Please try again.",
  },
  unknown: {
    error: "Segmentation failed",
    message:
      "We couldn't identify the object you clicked. Please try clicking directly on the object.",
  },
};

// SAM responses are small binary mask images; a ceiling this generous only
// trips on provider misbehavior, never on real masks.
const MAX_MASK_RESPONSE_BYTES = 10 * 1024 * 1024;

// SAM segmentation completes in seconds; bound the wait so a hung provider
// degrades to the retryable timeout copy instead of pinning the editor.
const SEGMENT_TIMEOUT_MS = 60_000;

type FalSubscribeFunction = (
  id: string,
  options: { input: Record<string, unknown>; abortSignal?: AbortSignal }
) => Promise<unknown>;

/**
 * Fetches the fal-hosted mask image and re-encodes it as a data URL so the
 * browser can composite it onto the mask canvas without a cross-origin
 * image load (which would depend on remote CORS headers and could taint
 * the canvas).
 * Side effects: performs one outbound HTTP fetch; throws on non-image or
 * oversized responses so the caller's catch block classifies the failure.
 */
async function fetchMaskAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(SEGMENT_TIMEOUT_MS) });
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
  // Timing anchor for the segment_server_timing events (issue #202).
  const startedAt = Date.now();
  // Hoisted so the catch block can correlate failures with the room even
  // when the error fires before/after the request body is parsed.
  let roomId: string | undefined;
  try {
    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "You must be signed in to select objects.",
          code: API_ERROR_UNAUTHORIZED,
        },
        { status: 401, headers: buildDeprecationHeaders() }
      );
    }

    const parsed = segmentRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "Please provide a valid roomId, imageUrl, click point, and image dimensions.",
          issues: parsed.error.issues,
          code: API_ERROR_INVALID_REQUEST,
        },
        { status: 400 }
      );
    }

    const { imageUrl, point, warm } = parsed.data;
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

    assertFalConfigured();

    // Pre-warm ping (issue #202): the editor fires this on open so the
    // first real click doesn't pay the route's cold path. It runs the
    // identical auth + room-ownership chain a click runs, then returns
    // WITHOUT the fal call — a pre-warm costs zero fal-ai/sam requests,
    // vs the 1 billed call every real click spends. The provider-side
    // image encode cannot be pre-warmed at all: `fal-ai/sam` exposes no
    // embedding input/output (see segment-mask.ts), so the encoder runs
    // inside each billed call on fal's servers.
    if (warm) {
      emitSegmentTiming(
        buildSegmentServerTimingEvent({
          totalMs: Date.now() - startedAt,
          falMs: null,
          warm: true,
          roomId: roomId ?? null,
        })
      );
      return NextResponse.json({ warmed: true });
    }

    // Synchronous SAM call: segmentation completes in seconds, so a direct
    // queue-aware subscribe keeps the flow single-round-trip instead of the
    // submit/poll pair the long-running inpaint run needs.
    const falStartedAt = Date.now();
    const falSubscribe = fal.subscribe as FalSubscribeFunction;
    const result = await falSubscribe(FAL_SAM_MODEL, {
      input: buildFalSegmentPayload({ imageUrl, point }),
      abortSignal: AbortSignal.timeout(SEGMENT_TIMEOUT_MS),
    });
    const falMs = Date.now() - falStartedAt;

    const mask = parseFalSegmentResponse(result);
    if (!mask) {
      throw new Error("Segmentation response did not include a mask image");
    }

    const maskDataUrl = await fetchMaskAsDataUrl(mask.maskUrl);

    // Issue #202 instrumentation: total vs fal split, so operators can see
    // how much of a click's latency is provider work (falMs — irreducible
    // without an embedding-split provider) vs our route overhead.
    emitSegmentTiming(
      buildSegmentServerTimingEvent({
        totalMs: Date.now() - startedAt,
        falMs,
        warm: false,
        roomId: roomId ?? null,
      })
    );

    return NextResponse.json({ maskDataUrl });
  } catch (error) {
    console.error(
      JSON.stringify({ event: "segment_failed", roomId: roomId ?? null }),
      error
    );

    const classified = classifyIntegrationError(error, SEGMENT_ERROR_COPY);

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

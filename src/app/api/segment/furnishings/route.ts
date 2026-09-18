import { NextRequest, NextResponse } from "next/server";
import { fal, assertFalConfigured } from "@/lib/fal";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { furnishingsSegmentRequestSchema } from "@/lib/ai-route-schemas";
import { classifyIntegrationError } from "@/lib/error-classify";
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

// SAM 3.1 detection completes in seconds; bound the wait so a hung
// provider degrades to the retryable timeout copy instead of hanging the
// preset run.
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

    const parsed = furnishingsSegmentRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "Please provide a valid roomId and imageUrl.",
          issues: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const { imageUrl } = parsed.data;
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
    // (the same pattern as /api/segment).
    const falSubscribe = fal.subscribe as FalSubscribeFunction;
    const result = await falSubscribe(FAL_FURNISHING_DETECTION_MODEL, {
      input: buildFurnishingDetectionPayload({ imageUrl }),
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

    return NextResponse.json({ maskDataUrls });
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

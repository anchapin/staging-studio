import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertFalConfigured, falSubscribeWithCircuitBreaker } from "@/lib/fal";
import { furnishingsSegmentRequestSchema } from "@/lib/ai-route-schemas";
import { classifyIntegrationError } from "@/lib/error-classify";

const SEGMENT_ERROR_COPY = {
  auth: {
    error: "Authentication error",
    message: "Could not authenticate with the segmentation service. Please try again.",
    code: "AUTH_ERROR",
  },
  rateLimit: {
    error: "Rate limit",
    message: "Segmentation service is busy. Please wait and try again.",
    code: "RATE_LIMIT",
  },
  timeout: {
    error: "Request timeout",
    message: "Segmentation request timed out. Please try again.",
    code: "TIMEOUT",
  },
  unknown: {
    error: "Segmentation failed",
    message: "Segmentation failed. Please try again.",
    code: "UNKNOWN",
  },
};

const DETECTION_TIMEOUT_MS = 30000;
const MAX_MASK_RESPONSE_BYTES = 10 * 1024 * 1024;
const FAL_FURNISHING_DETECTION_MODEL = "fal-ai/sam3.1/hierarchical/text";

export interface SegmentFurnishingsResult {
  concept: string;
  masks: Array<{ url: string; width: number; height: number }>;
  score: number;
}

export interface SegmentFurnishingsParams {
  userId: string;
  roomId: string;
  request: NextRequest;
}

export async function detectFurnishings(
  params: SegmentFurnishingsParams
): Promise<SegmentFurnishingsResult> {
  const { userId, roomId, request } = params;

  const body = await request.json();
  const parsed = furnishingsSegmentRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new SegmentValidationError(parsed.error);
  }
  const { imageUrl, concept: rawConcept } = parsed.data;
  const concept = rawConcept ?? "furnishing";

  const room = await prisma.room.findFirst({
    where: { id: roomId, project: { userId } },
    select: { id: true, name: true, beforeImageUrl: true },
  });
  if (!room) {
    throw new SegmentNotFoundError();
  }

  assertFalConfigured();

  let result: unknown;
  try {
    result = await falSubscribeWithCircuitBreaker(FAL_FURNISHING_DETECTION_MODEL, {
      input: {
        image_url: imageUrl,
        text: concept,
      },
      abortSignal: AbortSignal.timeout(DETECTION_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "segment_furnishings_error",
        roomId,
        imageUrl,
        concept,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    const classified = classifyIntegrationError(err, SEGMENT_ERROR_COPY);
    throw new SegmentServiceError(classified);
  }

  const detection = parseFurnishingDetectionResponse(result);
  if (!detection) {
    throw new SegmentServiceError({
      error: "Detection failed",
      message: "Detection response did not include mask images",
      retryable: false,
      code: "DETECTION_FAILED",
    });
  }

  const masks = await Promise.all(
    detection.maskUrls.map((maskUrl) => fetchMaskAsDataUrl(maskUrl))
  );

  return {
    concept,
    masks,
    score: detection.score ?? 0.9,
  };
}

interface DetectionResult {
  maskUrls: string[];
  score?: number;
}

function parseFurnishingDetectionResponse(
  result: unknown
): DetectionResult | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;

  const masks = r.masks;
  if (!Array.isArray(masks)) return null;

  const maskUrls = masks
    .filter((m) => m && typeof m === "object")
    .map((m) => (m as Record<string, unknown>).url as string)
    .filter((url) => typeof url === "string" && url.length > 0);

  if (maskUrls.length === 0) return null;

  return {
    maskUrls,
    score: typeof r.score === "number" ? r.score : undefined,
  };
}

async function fetchMaskAsDataUrl(url: string): Promise<{ url: string; width: number; height: number }> {
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
    throw new Error("Mask image response exceeds maximum size");
  }
  const base64 = Buffer.from(buffer).toString("base64");
  return {
    url: `data:${contentType};base64,${base64}`,
    width: 0,
    height: 0,
  };
}

export class SegmentValidationError extends Error {
  cause: unknown;
  constructor(error: unknown) {
    super("Validation failed");
    this.name = "SegmentValidationError";
    this.cause = error;
  }
}

export class SegmentNotFoundError extends Error {
  constructor() {
    super("Room not found");
    this.name = "SegmentNotFoundError";
  }
}

export class SegmentServiceError extends Error {
  code: string;
  retryable: boolean;
  status: number;

  constructor(classified: { error: string; message: string; retryable: boolean; code: string }) {
    super(classified.message);
    this.name = "SegmentServiceError";
    this.code = classified.code;
    this.retryable = classified.retryable;
    this.status = 500;
  }
}

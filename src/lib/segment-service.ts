import { fal, assertFalConfigured } from "@/lib/fal";
import { FAL_SAM_MODEL, buildFalSegmentPayload, parseFalSegmentResponse } from "@/lib/segment-mask";
import {
  DEFAULT_DAILY_SEGMENT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  evaluateDailyQuota,
  getDailyUsage,
  recordDailyUsage,
  resolveDailyLimit,
} from "@/lib/api-quota";
import { ApiError } from "@/lib/api-error-handler";
import {
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_ROOM_NOT_FOUND,
  API_ERROR_INTERNAL_SERVER,
} from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";

// ─── Mask Fetch ────────────────────────────────────────────────────────────────

const MAX_MASK_RESPONSE_BYTES = 10 * 1024 * 1024;
const SEGMENT_TIMEOUT_MS = 60_000;

/**
 * Fetches a mask image URL and converts it to a base64 data URL.
 * Used after SAM segmentation to convert the remote mask to a client-safe data URL.
 */
export async function fetchMaskAsDataUrl(url: string): Promise<string> {
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

// ─── Quota Check ─────────────────────────────────────────────────────────────

/**
 * Checks daily segmentation quota for a user. Throws ApiError if exceeded.
 */
export async function checkSegmentQuota(userId: string): Promise<void> {
  const segmentLimit = resolveDailyLimit(
    process.env[DAILY_LIMIT_ENV_VAR.segment],
    DEFAULT_DAILY_SEGMENT_LIMIT
  );
  const segmentQuota = evaluateDailyQuota(
    await getDailyUsage("segment", userId),
    segmentLimit
  );
  if (!segmentQuota.allowed) {
    throw new ApiError({
      code: API_ERROR_RATE_LIMIT_EXCEEDED,
      message: dailyQuotaExceededPayload(segmentQuota, "Please try again tomorrow.").message,
      status: 429,
    });
  }
}

// ─── Room Validation ─────────────────────────────────────────────────────────

/**
 * Validates that a room exists and belongs to the user.
 */
export async function validateSegmentRoom(roomId: string, userId: string): Promise<void> {
  const room = await prisma.room.findFirst({
    where: { id: roomId, project: { userId } },
    select: { id: true },
  });
  if (!room) {
    throw new ApiError({
      code: API_ERROR_ROOM_NOT_FOUND,
      message: "The requested room could not be found.",
      status: 404,
    });
  }
}

// ─── Segmentation ─────────────────────────────────────────────────────────────

type FalSubscribeFunction = (
  id: string,
  options: { input: Record<string, unknown>; abortSignal?: AbortSignal }
) => Promise<unknown>;

export interface SegmentResult {
  maskDataUrl: string;
  falMs: number;
}

/**
 * Runs SAM 3.1 segmentation via fal.ai and returns the mask as a data URL.
 * Records usage after a successful segmentation.
 */
export async function runSegmentation(params: {
  imageUrl: string;
  point: { x: number; y: number };
  roomId: string;
  userId: string;
}): Promise<SegmentResult> {
  const { imageUrl, point, userId } = params;

  assertFalConfigured();

  const falStartedAt = Date.now();
  const falSubscribe = fal.subscribe as FalSubscribeFunction;
  const result = await falSubscribe(FAL_SAM_MODEL, {
    input: buildFalSegmentPayload({ imageUrl, point }),
    abortSignal: AbortSignal.timeout(SEGMENT_TIMEOUT_MS),
  });
  const falMs = Date.now() - falStartedAt;

  const mask = parseFalSegmentResponse(result);
  if (!mask) {
    throw new ApiError({
      code: API_ERROR_INTERNAL_SERVER,
      message: "Segmentation did not return a mask. Please try again.",
      status: 500,
    });
  }

  const maskDataUrl = await fetchMaskAsDataUrl(mask.maskUrl);

  await recordDailyUsage("segment", userId);

  return { maskDataUrl, falMs };
}

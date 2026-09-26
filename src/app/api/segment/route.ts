import { NextRequest, NextResponse } from "next/server";
import { fal, assertFalConfigured } from "@/lib/fal";
import { prisma } from "@/lib/prisma";
import {
  getAuthedPrismaUser,
  requireProjectOwnership,
  ProjectNotFoundError,
  ProjectForbiddenError,
} from "@/lib/api-auth";
import { segmentRequestSchema } from "@/lib/ai-route-schemas";
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
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";

const MAX_MASK_RESPONSE_BYTES = 10 * 1024 * 1024;
const SEGMENT_TIMEOUT_MS = 60_000;

type FalSubscribeFunction = (
  id: string,
  options: { input: Record<string, unknown>; abortSignal?: AbortSignal }
) => Promise<unknown>;

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

export const POST = withErrorHandler(async (request: NextRequest) => {
  const startedAt = Date.now();

  const user = await getAuthedPrismaUser();
  if (!user) {
    throw new ApiError({
      code: API_ERROR_UNAUTHORIZED,
      message: "You must be signed in to select objects.",
      status: 401,
    });
  }

  const parsed = segmentRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new ApiError({
      code: API_ERROR_INVALID_REQUEST,
      message: "Please provide a valid roomId, imageUrl, click point, and image dimensions.",
      status: 400,
      details: parsed.error.issues,
    });
  }

  const { imageUrl, point, warm } = parsed.data;
  const roomId = parsed.data.roomId;

  const room = await prisma.room.findFirst({
    where: { id: roomId },
    select: { id: true, projectId: true },
  });
  if (!room) {
    throw new ApiError({
      code: API_ERROR_ROOM_NOT_FOUND,
      message: "The requested room could not be found.",
      status: 404,
    });
  }
  try {
    await requireProjectOwnership(room.projectId, user);
  } catch (e) {
    if (e instanceof ProjectNotFoundError) {
      throw new ApiError({ code: API_ERROR_ROOM_NOT_FOUND, message: "Project not found.", status: 404 });
    }
    if (e instanceof ProjectForbiddenError) {
      throw new ApiError({ code: API_ERROR_UNAUTHORIZED, message: "Forbidden.", status: 403 });
    }
    throw e;
  }

  assertFalConfigured();

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

  emitSegmentTiming(
    buildSegmentServerTimingEvent({
      totalMs: Date.now() - startedAt,
      falMs,
      warm: false,
      roomId: roomId ?? null,
    })
  );

  return NextResponse.json({ maskDataUrl });
});

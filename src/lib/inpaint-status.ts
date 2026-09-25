import { fal } from "@/lib/fal";
import { prisma } from "@/lib/prisma";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { decideInpaintPersistence } from "@/lib/inpaint-persistence";
import { classifyIntegrationError } from "@/lib/error-classify";
import { FAL_FLUX_FILL_MODEL } from "@/lib/prompts";
import {
  API_ERROR_INPAINT_STATUS_FAILED,
  API_ERROR_INPAINT_TERMINAL,
  API_ERROR_REQUEST_NOT_FOUND,
} from "@/lib/api-errors";

// ─── Rate Limiting ────────────────────────────────────────────────────────────

export const INPAINT_STATUS_RATE_LIMIT = 60;
const INPAINT_STATUS_RATE_WINDOW_MS = 60_000;

type RateLimitEntry = { count: number; windowStart: number };

const inpaintStatusRateLimitMap = new Map<string, RateLimitEntry>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Sliding-window rate limiter for inpaint status polling. Prevents abuse of a
 * route that is polled frequently from the client.
 */
export function checkInpaintStatusRateLimit(userId: string): RateLimitResult {
  const now = Date.now();
  const entry = inpaintStatusRateLimitMap.get(userId);
  if (!entry || now - entry.windowStart >= INPAINT_STATUS_RATE_WINDOW_MS) {
    inpaintStatusRateLimitMap.set(userId, { count: 1, windowStart: now });
    return { allowed: true, remaining: INPAINT_STATUS_RATE_LIMIT - 1, retryAfterMs: INPAINT_STATUS_RATE_WINDOW_MS };
  }
  if (entry.count >= INPAINT_STATUS_RATE_LIMIT) {
    const retryAfterMs = INPAINT_STATUS_RATE_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, remaining: 0, retryAfterMs: Math.ceil(retryAfterMs / 1000) };
  }
  entry.count++;
  return { allowed: true, remaining: INPAINT_STATUS_RATE_LIMIT - entry.count, retryAfterMs: INPAINT_STATUS_RATE_WINDOW_MS - (now - entry.windowStart) };
}

// ─── Error Copy ───────────────────────────────────────────────────────────────

const INPAINT_STATUS_ERROR_COPY = {
  notFound: {
    error: "Request not found",
    message: "This image processing request could not be found. It may have expired.",
    code: API_ERROR_REQUEST_NOT_FOUND,
  },
  unknown: {
    error: "Status check failed",
    message: "Unable to check image processing status. Please try again.",
    code: API_ERROR_INPAINT_STATUS_FAILED,
  },
} as const;

export const INPAINT_TERMINAL_ERROR_BODY = {
  status: "ERROR",
  error: "Inpainting failed",
  message: "The image editing process encountered an error. Please try again.",
  retryable: false,
  code: API_ERROR_INPAINT_TERMINAL,
} as const;

export type ClassifiedError = {
  error: string;
  message: string;
  retryable: boolean;
  code: string;
  status: number;
};

export function classifyStatusError(error: unknown): ClassifiedError {
  return classifyIntegrationError(error, INPAINT_STATUS_ERROR_COPY);
}

// ─── Fal Status Types ────────────────────────────────────────────────────────

interface FalStatusResult {
  status: string;
  images?: Array<{ url: string }>;
  error?: string;
}

type FalQueueStatusFunction = (id: string, options: { requestId: string }) => Promise<FalStatusResult>;
type FalQueueResultFunction = (id: string, options: { requestId: string }) => Promise<{ images?: Array<{ url: string }> } | null>;

// ─── Image Persistence ────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 30_000;

interface PersistenceResult {
  persisted: boolean;
  imageUrl: string | null;
}

/**
 * Downloads the fal result image and uploads it to Supabase storage.
 * Returns { persisted: true, imageUrl } on success, { persisted: false, imageUrl: null } on failure.
 * Issue #717: download failures are logged and correlatable.
 */
export async function persistFalImage(
  falImageUrl: string,
  requestId: string
): Promise<PersistenceResult> {
  let persisted = true;
  let resolvedImageUrl: string | null = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let imageBlob: Blob;
    try {
      imageBlob = await fetch(falImageUrl, { signal: controller.signal }).then((r) => r.blob());
    } finally {
      clearTimeout(timeoutId);
    }

    const supabase = await createSupabaseRequestClient();
    const objectPath = `after-${requestId}.png`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("staging-images")
      .upload(objectPath, imageBlob, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError || !uploadData) {
      persisted = false;
      console.error(
        JSON.stringify({ event: "inpaint_upload_failed", requestId }),
        uploadError?.message ?? "upload resolved without data"
      );
    } else {
      const { data: publicUrlData } = supabase.storage
        .from("staging-images")
        .getPublicUrl(objectPath);

      if (publicUrlData?.publicUrl) {
        resolvedImageUrl = publicUrlData.publicUrl;
      } else {
        persisted = false;
        console.error(
          JSON.stringify({ event: "inpaint_public_url_missing", requestId })
        );
      }
    }
  } catch (storageError) {
    persisted = false;
    console.error(
      JSON.stringify({ event: "inpaint_persist_failed", requestId }),
      storageError
    );
  }

  return { persisted, imageUrl: resolvedImageUrl };
}

// ─── Fal Status Polling ────────────────────────────────────────────────────────

export interface InpaintStatusResult {
  status: "completed" | "retryable" | "ERROR";
  imageUrl?: string | null;
  persisted?: boolean;
}

/**
 * Fetches fal queue status and handles all status transitions:
 * - COMPLETED: fetch result, persist to Supabase, update DB
 * - ERROR: mark terminal in DB, return terminal body
 * - PERSISTENCE_FAILED: retry persistence
 * - IN_QUEUE/PROCESSING: return current status
 */
export async function pollFalStatus(requestId: string): Promise<InpaintStatusResult> {
  const inpaintRequest = await prisma.inpaintRequest.findUnique({
    where: { id: requestId },
    select: {
      status: true,
      resultUrl: true,
      room: { select: { project: { select: { userId: true } } } },
    },
  });

  if (!inpaintRequest) {
    return { status: "ERROR", imageUrl: null, persisted: false };
  }

  // Already-done: serve stored result without touching fal
  const persistenceDecision = decideInpaintPersistence({
    status: inpaintRequest.status,
    resultUrl: inpaintRequest.resultUrl,
  });

  if (persistenceDecision.kind === "return-stored") {
    return { status: "completed", imageUrl: persistenceDecision.url, persisted: true };
  }

  // Terminal error: dead job, fail fast
  if (inpaintRequest.status === "ERROR") {
    return { status: "ERROR", imageUrl: null, persisted: false };
  }

  const falQueueStatus = fal.queue.status as FalQueueStatusFunction;
  const falQueueResult = fal.queue.result as FalQueueResultFunction;

  // PERSISTENCE_FAILED: retry persistence
  if (inpaintRequest.status === "PERSISTENCE_FAILED") {
    const falResult = await falQueueResult(FAL_FLUX_FILL_MODEL, { requestId }).catch(() => null);
    const falImageUrl: string | null = falResult?.images?.[0]?.url ?? null;
    if (!falImageUrl) {
      return { status: "retryable", imageUrl: null, persisted: false };
    }

    const { persisted, imageUrl } = await persistFalImage(falImageUrl, requestId);
    if (persisted && imageUrl) {
      await prisma.inpaintRequest.update({
        where: { id: requestId },
        data: { status: "COMPLETED", resultUrl: imageUrl },
      });
      return { status: "completed", imageUrl, persisted: true };
    }
    return { status: "retryable", imageUrl: falImageUrl, persisted: false };
  }

  // Fetch fal status
  const statusResponse = await falQueueStatus(FAL_FLUX_FILL_MODEL, { requestId });

  if (statusResponse.status === "ERROR") {
    // Best-effort: failed write must not flip terminal response back to retryable
    try {
      await prisma.inpaintRequest.update({ where: { id: requestId }, data: { status: "ERROR" } });
    } catch (recordError) {
      console.error(JSON.stringify({ event: "inpaint_error_record_failed", requestId }), recordError);
    }
    return { status: "ERROR", imageUrl: null, persisted: false };
  }

  if (statusResponse.status === "COMPLETED") {
    const falResult = await falQueueResult(FAL_FLUX_FILL_MODEL, { requestId }).catch((resultError: unknown) => {
      console.error(JSON.stringify({ event: "inpaint_result_fetch_failed", requestId }), resultError);
      return null;
    });
    const falImageUrl = falResult?.images?.[0]?.url;

    if (!falImageUrl) {
      return { status: "retryable", imageUrl: null, persisted: false };
    }

    const { persisted, imageUrl } = await persistFalImage(falImageUrl, requestId);

    if (persisted && imageUrl) {
      try {
        await prisma.inpaintRequest.update({
          where: { id: requestId },
          data: { status: "COMPLETED", resultUrl: imageUrl },
        });
      } catch (recordError) {
        console.error(JSON.stringify({ event: "inpaint_record_failed", requestId }), recordError);
      }
      return { status: "completed", imageUrl, persisted: true };
    }

    // Persistence failed: mark PERSISTENCE_FAILED so subsequent polls retry
    await prisma.inpaintRequest.update({
      where: { id: requestId },
      data: { status: "PERSISTENCE_FAILED", resultUrl: null },
    });
    return { status: "retryable", imageUrl: falImageUrl, persisted: false };
  }

  return { status: "retryable", imageUrl: null, persisted: false };
}

// ─── Request Ownership Validation ─────────────────────────────────────────────

export interface InpaintRequestIdentity {
  requestId: string;
  userId: string;
}

/**
 * Validates that an inpaint request exists and belongs to the user (via room/project).
 * Returns the request identity if valid, null if not found or not owned.
 */
export async function validateInpaintRequestOwnership(
  requestId: string,
  userId: string
): Promise<InpaintRequestIdentity | null> {
  const inpaintRequest = await prisma.inpaintRequest.findUnique({
    where: { id: requestId },
    select: {
      room: { select: { project: { select: { userId: true } } } },
    },
  });

  if (!inpaintRequest || inpaintRequest.room.project.userId !== userId) {
    return null;
  }

  return { requestId, userId };
}

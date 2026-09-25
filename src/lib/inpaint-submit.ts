import { z } from "zod";
import { falQueueSubmitWithCircuitBreaker } from "@/lib/fal";
import { prisma } from "@/lib/prisma";
import { inpaintRequestSchema } from "@/lib/ai-route-schemas";
import { evaluateInpaintQualityGate } from "@/lib/inpaint-quality-gate";
import { classifyIntegrationError } from "@/lib/error-classify";
import {
  buildFalFillPayload,
  buildInpaintPrompt,
  FAL_FLUX_FILL_MODEL,
} from "@/lib/prompts";
import {
  DEFAULT_DAILY_INPAINT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  evaluateDailyQuota,
  inpaintDailyUsageWhere,
  resolveDailyLimit,
  type DailyQuotaExceededPayload,
} from "@/lib/api-quota";
import { API_ERROR_INPAINT_SUBMIT_FAILED } from "@/lib/api-errors";

// ─── Public Schema ────────────────────────────────────────────────────────────

export const inpaintSubmitSchema = inpaintRequestSchema.extend({
  roomId: z.string().min(1),
  variantSlot: z
    .number()
    .int()
    .refine((value) => value === 0 || value === 1),
  sourceSlot: z
    .number()
    .int()
    .refine((value) => value === 0 || value === 1)
    .nullable()
    .optional(),
  maskCoverageRatio: z.number().min(0).max(1).optional(),
});

export type InpaintSubmitInput = z.infer<typeof inpaintSubmitSchema>;

// ─── Error Copy ──────────────────────────────────────────────────────────────

export const INPAINT_ERROR_COPY = {
  auth: {
    error: "Authentication failed",
    message:
      "Unable to connect to the image editing service. Please check your configuration.",
    code: API_ERROR_INPAINT_SUBMIT_FAILED,
  },
  timeout: {
    error: "Request timeout",
    message:
      "The image editing service is taking too long to respond. Please try again.",
    code: API_ERROR_INPAINT_SUBMIT_FAILED,
  },
  unknown: {
    error: "Inpainting failed",
    message: "We couldn't process your image. Please try again.",
    code: API_ERROR_INPAINT_SUBMIT_FAILED,
  },
} as const;

// ─── Fal Submit Retry (Issue #831) ───────────────────────────────────────────

const FAL_SUBMIT_ATTEMPTS = 3;
const FAL_SUBMIT_BASE_DELAY_MS = 200;

type FalQueueSubmitFunction = (
  id: string,
  options: { input: Record<string, unknown> }
) => Promise<{ request_id: string }>;

/**
 * Issue #831: wraps fal.queue.submit with exponential-backoff retry for
 * transient errors (network failures, timeouts, 5xx HTTP responses).
 * Auth errors (401/403) are not retried — they indicate a config problem
 * that subsequent attempts will not resolve.
 */
export async function submitWithRetry(
  falQueueSubmit: FalQueueSubmitFunction,
  model: string,
  payload: { input: Record<string, unknown> }
): Promise<{ request_id: string }> {
  for (let attempt = 1; attempt <= FAL_SUBMIT_ATTEMPTS; attempt += 1) {
    try {
      return await falQueueSubmit(model, payload);
    } catch (error) {
      const isLastAttempt = attempt === FAL_SUBMIT_ATTEMPTS;
      const isAuthError =
        error != null &&
        typeof error === "object" &&
        "status" in error &&
        (error.status === 401 || error.status === 403);

      if (isLastAttempt || isAuthError) {
        throw error;
      }

      const delayMs = FAL_SUBMIT_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.error(
        JSON.stringify({
          event: "fal_submit_retry",
          attempt,
          attempts: FAL_SUBMIT_ATTEMPTS,
          delayMs,
        }),
        error
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Unexpected: submitWithRetry exhausted all attempts");
}

// ─── Inpaint Record Creation with Retry (Issue #688) ─────────────────────────

const INPAINT_CREATE_ATTEMPTS = 3;
const INPAINT_CREATE_RETRY_DELAY_MS = 200;

export interface InpaintRecordCreateData {
  id: string;
  roomId: string;
  variantSlot: number;
  sourceSlot: number | null;
  status: "IN_QUEUE";
}

/**
 * Issue #688: by the time the requestId → room row is written, the fal
 * job is already queued and billed. A transient DB failure there must
 * NOT surface as a 500 — the client's retry would submit a brand-new
 * paid job while the first run stays orphaned. Bounded retry with
 * backoff is the primary defense; if every attempt fails, the response
 * degrades.
 */
export async function createInpaintRequestWithRetry(
  data: InpaintRecordCreateData
): Promise<void> {
  for (let attempt = 1; attempt <= INPAINT_CREATE_ATTEMPTS; attempt += 1) {
    try {
      await prisma.inpaintRequest.create({ data });
      return;
    } catch (error) {
      if (attempt === INPAINT_CREATE_ATTEMPTS) {
        throw error;
      }
      console.error(
        JSON.stringify({
          event: "inpaint_record_create_retry",
          requestId: data.id,
          roomId: data.roomId,
          attempt,
          attempts: INPAINT_CREATE_ATTEMPTS,
        }),
        error
      );
      await new Promise((resolve) =>
        setTimeout(resolve, INPAINT_CREATE_RETRY_DELAY_MS)
      );
    }
  }
}

// ─── Quality Gate ─────────────────────────────────────────────────────────────

export interface QualityGateResult {
  qualityWarnings: string[];
}

/**
 * Issue #600: inpaint pre-flight quality gate — evaluate directive quality
 * before spending fal.ai budget. Runs after quota check + validation, before
 * fal.queue.submit. Advisory only; warnings ride along with the submission.
 * Issue #685: the gate is failure-tolerant — ANY evaluator failure (OpenAI
 * outage, rate limit, timeout, missing key) or omitted maskCoverageRatio
 * skips the gate with empty warnings instead of failing the submission.
 */
export async function evaluateQualityGate(
  roomName: string,
  maskCoverageRatio: number | undefined,
  promptDirectives: string
): Promise<QualityGateResult> {
  const qualityWarnings = await evaluateInpaintQualityGate({
    roomName,
    maskCoverageRatio,
    promptDirectives,
  });
  return { qualityWarnings };
}

// ─── Fal Submit ───────────────────────────────────────────────────────────────

export interface FalSubmitOptions {
  imageUrl: string;
  maskUrl: string;
  aesthetic: string;
  promptDirectives: string;
  negativePrompt?: string;
  promptStrength?: number;
  maskBlur?: number;
  seed?: number;
  creativeMode?: boolean;
}

/**
 * Fire-and-forget submit: returns as soon as the job is queued (~2s),
 * instead of holding the request open for the full generation.
 * submitWithRetry handles transient errors; the circuit breaker wrapper
 * (falQueueSubmitWithCircuitBreaker) prevents cascading failures when
 * the service is degraded.
 */
export async function submitInpaintToFal(
  options: FalSubmitOptions
): Promise<{ request_id: string }> {
  const { imageUrl, maskUrl, aesthetic, promptDirectives, negativePrompt, promptStrength, maskBlur, seed, creativeMode } = options;
  const prompt = buildInpaintPrompt(aesthetic, promptDirectives);

  return submitWithRetry(falQueueSubmitWithCircuitBreaker, FAL_FLUX_FILL_MODEL, {
    input: buildFalFillPayload({
      imageUrl,
      maskUrl,
      prompt,
      negativePrompt,
      promptStrength,
      maskBlur,
      seed,
      creativeMode,
    }),
  });
}

// ─── Error Classification ─────────────────────────────────────────────────────

export type ClassifiedError = {
  error: string;
  message: string;
  retryable: boolean;
  code: string;
  status: number;
};

/**
 * Classifies integration errors using the standard error classification logic.
 */
export function classifyInpaintError(error: unknown): ClassifiedError {
  return classifyIntegrationError(error, INPAINT_ERROR_COPY);
}

// ─── Quota Check ─────────────────────────────────────────────────────────────

export interface QuotaCheckResult {
  allowed: boolean;
  dailyLimit: number;
  currentUsage: number;
  payload?: DailyQuotaExceededPayload;
}

/**
 * Checks the daily inpaint quota for a user.
 */
export async function checkDailyQuota(
  userId: string
): Promise<QuotaCheckResult> {
  const dailyLimit =
    resolveDailyLimit(process.env[DAILY_LIMIT_ENV_VAR.inpaint], DEFAULT_DAILY_INPAINT_LIMIT) ?? 0;

  const inpaintCount = await prisma.inpaintRequest.count({
    where: inpaintDailyUsageWhere(userId),
  });

  const decision = evaluateDailyQuota(inpaintCount, dailyLimit);

  if (!decision.allowed) {
    return {
      allowed: false,
      dailyLimit,
      currentUsage: decision.used,
      payload: dailyQuotaExceededPayload(decision, "Please try again tomorrow."),
    };
  }

  return { allowed: true, dailyLimit, currentUsage: decision.used };
}

// ─── Room Validation ─────────────────────────────────────────────────────────

export interface ValidatedRoom {
  id: string;
  name: string;
  afterImageUrl: string | null;
  afterImageUrl2: string | null;
}

/**
 * Validates that a room exists and belongs to the user, checking source slot
 * availability for variant-source runs (issue #170).
 */
export async function validateInpaintRoom(
  roomId: string,
  userId: string,
  sourceSlot: number | null
): Promise<{ room: ValidatedRoom | null; error: string | null; status: number }> {
  const room = await prisma.room.findFirst({
    where: { id: roomId, project: { userId } },
    select: { id: true, name: true, afterImageUrl: true, afterImageUrl2: true },
  });

  if (!room) {
    return {
      room: null,
      error: "Room not found. The requested room could not be found.",
      status: 404,
    };
  }

  if (
    (sourceSlot === 0 && !room.afterImageUrl) ||
    (sourceSlot === 1 && !room.afterImageUrl2)
  ) {
    return {
      room: null,
      error: "The selected variant has no staged result to edit from.",
      status: 400,
    };
  }

  return { room, error: null, status: 200 };
}

// ─── Submission + Persistence Combined ────────────────────────────────────────

export interface SubmitInpaintResult {
  requestId: string;
  qualityWarnings: string[];
  recordDegraded: boolean;
}

/**
 * Combines fal submission, quality gate evaluation, and persistence in a
 * single orchestrating function. Returns submission result and degraded flag
 * if record creation failed (issue #688 — graceful degradation).
 */
export async function submitInpaintRequest(
  room: ValidatedRoom,
  params: {
    imageUrl: string;
    maskUrl: string;
    aesthetic: string;
    promptDirectives: string;
    negativePrompt?: string;
    promptStrength?: number;
    maskBlur?: number;
    seed?: number;
    creativeMode?: boolean;
    maskCoverageRatio?: number;
    variantSlot: number;
    sourceSlot: number | null;
  }
): Promise<SubmitInpaintResult> {
  const { qualityWarnings } = await evaluateQualityGate(
    room.name,
    params.maskCoverageRatio,
    params.promptDirectives
  );

  const submission = await submitInpaintToFal({
    imageUrl: params.imageUrl,
    maskUrl: params.maskUrl,
    aesthetic: params.aesthetic,
    promptDirectives: params.promptDirectives,
    negativePrompt: params.negativePrompt,
    promptStrength: params.promptStrength,
    maskBlur: params.maskBlur,
    seed: params.seed,
    creativeMode: params.creativeMode,
  });

  let recordDegraded = false;
  try {
    await createInpaintRequestWithRetry({
      id: submission.request_id,
      roomId: room.id,
      variantSlot: params.variantSlot,
      sourceSlot: params.sourceSlot,
      status: "IN_QUEUE",
    });
  } catch (recordError) {
    recordDegraded = true;
    console.error(
      JSON.stringify({
        event: "inpaint_record_create_failed",
        requestId: submission.request_id,
        roomId: room.id,
        attempts: 3,
        degraded: true,
      }),
      recordError
    );
  }

  return {
    requestId: submission.request_id,
    qualityWarnings,
    recordDegraded,
  };
}

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { inpaintRequestSchema } from "@/lib/ai-route-schemas";
import { evaluateInpaintQualityGate } from "@/lib/inpaint-quality-gate";
import { classifyIntegrationError } from "@/lib/error-classify";
import {
  buildInpaintPayloadForActiveProvider,
  buildInpaintPrompt,
} from "@/lib/prompts";
import {
  getInferenceClient,
  InferenceRequestGoneError,
  LOGICAL_MODEL,
  type LogicalInpaintInput,
  type LogicalModel,
} from "@/lib/inference";
import {
  DEFAULT_DAILY_INPAINT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  evaluateDailyQuota,
  getDailyUsage,
  recordDailyUsage,
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
      "We couldn't reach the staging service — please try again in a moment.",
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
 *
 * Issue #1201: an `InferenceRequestGoneError` (a 404 from the provider's
 * submit endpoint) is retried exactly once, immediately, with the same
 * payload. The 404 reflects transient queue/routing state, not the
 * input, and no InpaintRequest row exists yet, so a resend cannot
 * double-bill. A second 404 propagates as-is. This one-shot retry is
 * separate from the 5xx backoff budget.
 */
export async function submitWithRetry(
  falQueueSubmit: FalQueueSubmitFunction,
  model: string,
  payload: { input: Record<string, unknown> }
): Promise<{ request_id: string }> {
  let goneRetried = false;
  for (let attempt = 1; attempt <= FAL_SUBMIT_ATTEMPTS; attempt += 1) {
    try {
      return await falQueueSubmit(model, payload);
    } catch (error) {
      if (error instanceof InferenceRequestGoneError) {
        if (goneRetried) throw error;
        goneRetried = true;
        console.warn(
          JSON.stringify({ event: "inference_submit_gone_retry", provider: error.provider }),
          error
        );
        try {
          return await falQueueSubmit(model, payload);
        } catch (retryError) {
          if (retryError instanceof InferenceRequestGoneError) throw retryError;
          error = retryError;
        }
      }

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

// ─── Quota Charge (Issue #1131) ──────────────────────────────────────────────

const INPAINT_QUOTA_CHARGE_ATTEMPTS = 3;
const INPAINT_QUOTA_CHARGE_RETRY_DELAY_MS = 200;

/**
 * Records one billable unit against today's `inpaint` quota row.
 *
 * Called once the fal.ai job is already queued and billed (issue #1131):
 * before the counter table existed, the only record of the spend was the
 * `InpaintRequest` row, which a room delete could remove. The counter is
 * written with bounded retry for the same reason the record write is
 * (#688) — a transient DB failure must not discard the charge for work
 * that was already paid for. Throws after all attempts so the caller can
 * log it; the caller must NOT convert that into a failed response, because
 * the client's retry would queue a SECOND billable job (#1111 tracks
 * closing the window between the submit and this write).
 */
export async function recordInpaintQuotaWithRetry(userId: string): Promise<void> {
  for (let attempt = 1; attempt <= INPAINT_QUOTA_CHARGE_ATTEMPTS; attempt += 1) {
    try {
      await recordDailyUsage("inpaint", userId);
      return;
    } catch (error) {
      if (attempt === INPAINT_QUOTA_CHARGE_ATTEMPTS) {
        throw error;
      }
      console.error(
        JSON.stringify({
          event: "inpaint_quota_charge_retry",
          userId,
          attempt,
          attempts: INPAINT_QUOTA_CHARGE_ATTEMPTS,
        }),
        error
      );
      await new Promise((resolve) =>
        setTimeout(resolve, INPAINT_QUOTA_CHARGE_RETRY_DELAY_MS)
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
 * submitWithRetry handles transient errors; the abstraction's
 * circuit breaker wrapper (per provider) prevents cascading failures
 * when the service is degraded.
 */
export async function submitInpaintToFal(
  options: FalSubmitOptions
): Promise<{ request_id: string }> {
  const { imageUrl, maskUrl, aesthetic, promptDirectives, negativePrompt, promptStrength, maskBlur, seed, creativeMode } = options;
  const prompt = buildInpaintPrompt(aesthetic, promptDirectives);

  // Resolve the active provider once. The submit call goes through
  // the abstraction's `submit` method, which routes to the right
  // client. The payload schema differs per provider (fal expects
  // snake_case `image_url`/`mask_url`; Replicate expects `image`/
  // `mask`) so the payload builder is selected by the abstraction's
  // provider name, not the call site.
  const client = await getInferenceClient();
  const logicalInput: LogicalInpaintInput = {
    imageUrl,
    maskUrl,
    prompt,
    negativePrompt,
    promptStrength,
    maskBlur,
    seed,
    creativeMode,
  };
  const input = buildInpaintPayloadForActiveProvider(logicalInput);

  // Reuse the existing retry wrapper, but pass the abstraction's
  // `submit` shape. The retry policy (transient 5xx retry, no
  // retry on auth 401/403) is provider-agnostic and lives here.
  // `submitWithRetry` types the first arg as `string`; the
  // `LogicalModel` union is a string-literal, so the cast is safe.
  const submit: (id: string, options: { input: Record<string, unknown> }) => Promise<{ request_id: string }> =
    (id, options) => client.submit(id as LogicalModel, options);
  return submitWithRetry(submit, LOGICAL_MODEL.FLUX_FILL, { input });
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
 *
 * Usage is read from the `DailyApiUsage` counter row, NOT derived by
 * counting `InpaintRequest` rows (issue #1131): those rows cascade-delete
 * with their room, so a user who deleted the rooms staged today had the
 * count — and therefore the whole cap — restored at zero cost. The counter
 * row is not a child of any user content, so no delete refunds it.
 */
export async function checkDailyQuota(
  userId: string
): Promise<QuotaCheckResult> {
  const dailyLimit =
    resolveDailyLimit(process.env[DAILY_LIMIT_ENV_VAR.inpaint], DEFAULT_DAILY_INPAINT_LIMIT) ?? 0;

  const inpaintCount = await getDailyUsage("inpaint", userId);

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
  /** True when the quota counter could not be written for a billed job (#1131). */
  quotaChargeDegraded: boolean;
}

/**
 * Combines fal submission, quality gate evaluation, quota charge, and
 * persistence in a single orchestrating function. Returns the submission
 * result plus degraded flags if the record write (#688) or the quota
 * charge (#1131) failed after the job was already billed — both are logged
 * and tolerated rather than surfaced as a failure, because the client's
 * retry would queue a second billable job.
 */
export async function submitInpaintRequest(
  room: ValidatedRoom,
  params: {
    userId: string;
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

  // The fal job is queued and billed at this point, so the quota unit is
  // charged BEFORE anything else can fail (#1131). Deliberately still after
  // the submit, not a reservation before it: reserving first is #1111/#1132
  // and depends on an atomic claim, which this write is not.
  let quotaChargeDegraded = false;
  try {
    await recordInpaintQuotaWithRetry(params.userId);
  } catch (chargeError) {
    quotaChargeDegraded = true;
    console.error(
      JSON.stringify({
        event: "inpaint_quota_charge_failed",
        requestId: submission.request_id,
        roomId: room.id,
        userId: params.userId,
        attempts: INPAINT_QUOTA_CHARGE_ATTEMPTS,
        degraded: true,
      }),
      chargeError
    );
  }

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
    quotaChargeDegraded,
  };
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fal } from "@/lib/fal";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { inpaintRequestSchema } from "@/lib/ai-route-schemas";
import { evaluateInpaintQualityGate } from "@/lib/inpaint-quality-gate";
import { classifyIntegrationError } from "@/lib/error-classify";
import {
  DEFAULT_DAILY_INPAINT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  evaluateDailyQuota,
  inpaintDailyUsageWhere,
  resolveDailyLimit,
} from "@/lib/api-quota";
import {
  FAL_FLUX_FILL_MODEL,
  buildFalFillPayload,
  buildInpaintPrompt,
} from "@/lib/prompts";

const INPAINT_ERROR_COPY = {
  auth: {
    error: "Authentication failed",
    message: "Unable to connect to the image editing service. Please check your configuration.",
  },
  timeout: {
    error: "Request timeout",
    message: "The image editing service is taking too long to respond. Please try again.",
  },
  unknown: {
    error: "Inpainting failed",
    message: "We couldn't process your image. Please try again.",
  },
};

const inpaintSubmitSchema = inpaintRequestSchema.extend({
  roomId: z.string().min(1),
  variantSlot: z
    .number()
    .int()
    .refine((value) => value === 0 || value === 1),
  // Issue #170: null/omitted = the run edits the original before photo;
  // 0/1 = the run edits that variant's staged result (persisted so a
  // pendingRequestId resume applies the same persistence semantics).
  sourceSlot: z
    .number()
    .int()
    .refine((value) => value === 0 || value === 1)
    .nullable()
    .optional(),
  // Issue #600: mask coverage ratio computed client-side via
  // `estimateMaskCoverage` — passed up so the quality gate can evaluate
  // whether the mask aligns with the stated directive intent.
  maskCoverageRatio: z.number().min(0).max(1).optional(),
});

type FalQueueSubmitFunction = (
  id: string,
  options: { input: Record<string, unknown> }
) => Promise<{ request_id: string }>;

// Issue #831: fal.queue.submit has no built-in retry for transient errors.
// Retries with exponential backoff for network/timeout/5xx failures.
// Auth errors (401/403) are non-retryable — they indicate a config problem
// that retries will not resolve.
const FAL_SUBMIT_ATTEMPTS = 3;
const FAL_SUBMIT_BASE_DELAY_MS = 200;

// Issue #688: by the time the requestId → room row is written, the fal
// job is already queued and billed. A transient DB failure there must
// NOT surface as a 500 — the client's retry would submit a brand-new
// paid job while the first run stays orphaned. Bounded retry with
// backoff is the primary defense; if every attempt fails, the response
// degrades (see the response-shape comment below).
const INPAINT_CREATE_ATTEMPTS = 3;
const INPAINT_CREATE_RETRY_DELAY_MS = 200;

interface InpaintRecordCreateData {
  id: string;
  roomId: string;
  variantSlot: number;
  sourceSlot: number | null;
  status: "IN_QUEUE";
}

async function createInpaintRequestWithRetry(
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

// Issue #831: wraps fal.queue.submit with exponential-backoff retry for
// transient errors (network failures, timeouts, 5xx HTTP responses).
// Auth errors (401/403) are not retried — they indicate a config problem
// that subsequent attempts will not resolve.
async function submitWithRetry(
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
  // Satisfy TypeScript: this is unreachable because the loop always returns
  // or throws, but the return type requires a value.
  throw new Error("submitWithRetry: unexpected exit");
}

export async function POST(request: NextRequest) {
  // Hoisted so the catch block can correlate failures with the room even
  // when the error fires before/after the request body is parsed.
  let roomId: string | undefined;
  try {
    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "You must be signed in to start inpainting.",
        },
        { status: 401 }
      );
    }

    // Issue #201: daily per-user fal.ai cost guardrail. Today's usage is
    // counted from the persisted InpaintRequest rows (see lib/api-quota.ts
    // for the mechanism and its in-flight race) BEFORE the body is even
    // parsed — a user at their cap never reaches the paid provider.
    const inpaintLimit = resolveDailyLimit(
      process.env[DAILY_LIMIT_ENV_VAR.inpaint],
      DEFAULT_DAILY_INPAINT_LIMIT
    );
    const inpaintUsed = await prisma.inpaintRequest.count({
      where: inpaintDailyUsageWhere(user.id),
    });
    const inpaintQuota = evaluateDailyQuota(inpaintUsed, inpaintLimit);
    if (!inpaintQuota.allowed) {
      console.warn(
        JSON.stringify({
          event: "inpaint_daily_quota_exceeded",
          userId: user.id,
          used: inpaintQuota.used,
          limit: inpaintQuota.limit,
        })
      );
      return NextResponse.json(
        dailyQuotaExceededPayload(inpaintQuota, "Please try again tomorrow."),
        { status: 429 }
      );
    }

    const parsed = inpaintSubmitSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message:
            "Please provide a valid imageUrl, maskUrl, promptDirectives, aesthetic, roomId, variantSlot, and sourceSlot.",
          issues: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const { imageUrl, maskUrl, promptDirectives, aesthetic, variantSlot, negativePrompt } =
      parsed.data;
    const sourceSlot = parsed.data.sourceSlot ?? null;
    // Issue #558: AI guidance controls
    const { promptStrength, maskBlur, seed, creativeMode } = parsed.data;
    roomId = parsed.data.roomId;

    const room = await prisma.room.findFirst({
      where: { id: roomId, project: { userId: user.id } },
      select: { id: true, name: true, afterImageUrl: true, afterImageUrl2: true },
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

    // A variant-source run (issue #170) edits that variant's staged result —
    // reject up front when the slot has no result to edit from, so a run can
    // never claim a source it cannot have.
    if (
      (sourceSlot === 0 && !room.afterImageUrl) ||
      (sourceSlot === 1 && !room.afterImageUrl2)
    ) {
      return NextResponse.json(
        {
          error: "Invalid source",
          message: "The selected variant has no staged result to edit from.",
        },
        { status: 400 }
      );
    }

    const prompt = buildInpaintPrompt(aesthetic, promptDirectives);

    // Issue #600: inpaint pre-flight quality gate — evaluate directive quality
    // before spending fal.ai budget. Runs after quota check + validation, before
    // fal.queue.submit. Advisory only; warnings ride along with the submission.
    // Issue #685: the gate is failure-tolerant — ANY evaluator failure (OpenAI
    // outage, rate limit, timeout, missing key) or omitted maskCoverageRatio
    // skips the gate with empty warnings instead of failing the submission.
    const qualityWarnings = await evaluateInpaintQualityGate({
      roomName: room.name,
      maskCoverageRatio: parsed.data.maskCoverageRatio,
      promptDirectives,
    });

    // Fire-and-forget submit: returns as soon as the job is queued (~2s),
    // instead of holding the request open for the full generation.
    // Issue #831: submitWithRetry handles transient errors with exponential backoff.
    const falQueueSubmit = fal.queue.submit as FalQueueSubmitFunction;
    const submission = await submitWithRetry(falQueueSubmit, FAL_FLUX_FILL_MODEL, {
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

    // Persist the requestId → room mapping before responding so the status
    // route can attribute requests and a refresh can resume polling.
    // Issue #688: the paid fal job is already queued at this point, so a
    // DB blip must not 500 (the client's retry would submit a second
    // paid job). Retry with backoff; if every attempt fails, degrade the
    // response instead of erroring.
    let recordDegraded = false;
    try {
      await createInpaintRequestWithRetry({
        id: submission.request_id,
        roomId: room.id,
        variantSlot,
        sourceSlot,
        status: "IN_QUEUE",
      });
    } catch (recordError) {
      recordDegraded = true;
      console.error(
        JSON.stringify({
          event: "inpaint_record_create_failed",
          requestId: submission.request_id,
          roomId: room.id,
          attempts: INPAINT_CREATE_ATTEMPTS,
          degraded: true,
        }),
        recordError
      );
    }

    // Response shape (issue #688): `{ requestId, qualityWarnings }` on the
    // happy path; `{ requestId, qualityWarnings, degraded: true }` when the
    // paid fal job was submitted but the mapping row could not be persisted
    // after INPAINT_CREATE_ATTEMPTS attempts. Residual gap (accepted for
    // #688, documented rather than widened): with no row,
    // `GET /api/inpaint/[requestId]/status` 404s — it cannot attribute an
    // unknown requestId to this caller without weakening the ownership
    // check — so a fully degraded run is not pollable; the flag lets the
    // client suppress a duplicate paid re-submit (#698) and the
    // `inpaint_record_create_failed` log line anchors recovery of the
    // billed requestId.
    return NextResponse.json({
      requestId: submission.request_id,
      qualityWarnings,
      ...(recordDegraded ? { degraded: true } : {}),
    });
  } catch (error) {
    console.error(
      JSON.stringify({ event: "inpaint_submit_failed", roomId: roomId ?? null }),
      error
    );

    const classified = classifyIntegrationError(error, INPAINT_ERROR_COPY);

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

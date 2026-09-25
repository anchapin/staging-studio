import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertFalConfigured } from "@/lib/fal";
import { inpaintRequestSchema } from "@/lib/ai-route-schemas";
import { evaluateInpaintQualityGate } from "@/lib/inpaint-quality-gate";
import { classifyIntegrationError } from "@/lib/error-classify";

const INPAINT_SUBMIT_MAX_RETRIES = 3;
const INPAINT_SUBMIT_RETRY_DELAY_BASE_MS = 2000;

const INPAINT_ERROR_COPY = {
  auth: {
    error: "Authentication error",
    message: "Could not authenticate with the inpainting service. Please try again.",
    code: "AUTH_ERROR",
  },
  rateLimit: {
    error: "Rate limit",
    message: "Inpainting service is busy. Please try again in a moment.",
    code: "RATE_LIMIT",
  },
  timeout: {
    error: "Request timeout",
    message: "Inpainting request timed out. Please try again.",
    code: "TIMEOUT",
  },
  unknown: {
    error: "Inpainting failed",
    message: "Inpainting failed. Please try again.",
    code: "UNKNOWN",
  },
};

export interface InpaintSubmitResult {
  inpaintRequestId: string;
  queued: boolean;
  qualityWarnings: string[];
}

export interface InpaintSubmitParams {
  userId: string;
  roomId: string;
  request: NextRequest;
}

export async function submitInpaintRequest(
  params: InpaintSubmitParams
): Promise<InpaintSubmitResult> {
  const { userId, roomId, request } = params;

  const body = await request.json();
  const parsed = inpaintRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new InpaintValidationError(parsed.error);
  }

  const { imageUrl, maskUrl, promptDirectives, aesthetic, variantSlot, sourceSlot, negativePrompt } = body;
  const { promptStrength, maskBlur, seed, creativeMode } = parsed.data;

  const room = await prisma.room.findFirst({
    where: { id: roomId, project: { userId } },
    select: {
      id: true,
      name: true,
      beforeImageUrl: true,
      afterImageUrl: true,
    },
  });
  if (!room) {
    throw new InpaintNotFoundError();
  }

  assertFalConfigured();

  const qualityWarnings = await evaluateInpaintQualityGate({
    roomName: room.name,
    maskCoverageRatio: 0,
    promptDirectives,
  });

  const inpaintRequest = await submitInpaintWithRetry({
    roomId,
    imageUrl,
    variantSlot,
    sourceSlot: sourceSlot ?? null,
    maskUrl,
    promptDirectives,
    aesthetic,
    negativePrompt,
    promptStrength: promptStrength ?? 0.7,
    maskBlur: maskBlur ?? 0,
    seed,
    creativeMode: creativeMode ?? false,
  });

  return {
    inpaintRequestId: inpaintRequest.id,
    queued: inpaintRequest.status === "IN_QUEUE",
    qualityWarnings,
  };
}

interface SubmitInpaintParams {
  roomId: string;
  imageUrl: string;
  variantSlot: number;
  sourceSlot: number | null;
  maskUrl: string;
  promptDirectives: string;
  aesthetic: string;
  negativePrompt?: string;
  promptStrength?: number;
  maskBlur?: number;
  seed?: number;
  creativeMode?: boolean;
}

async function submitInpaintWithRetry(
  params: SubmitInpaintParams
): Promise<{ id: string; status: string }> {
  const { falQueueSubmitWithCircuitBreaker } = await import("@/lib/fal");
  const { buildInpaintPrompt } = await import("@/lib/prompts");

  let lastError: unknown;

  for (let attempt = 0; attempt < INPAINT_SUBMIT_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(INPAINT_SUBMIT_RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1));
    }

    try {
      const id = `inpaint_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const prompt = buildInpaintPrompt(params.aesthetic, params.promptDirectives);

      const submission = await falQueueSubmitWithCircuitBreaker(id, {
        input: {
          image_url: params.imageUrl,
          mask_image_url: params.maskUrl,
          prompt,
          negative_prompt: params.negativePrompt,
          prompt_strength: params.promptStrength,
          mask_blur: params.maskBlur,
          seed: params.seed,
          creative_mode: params.creativeMode,
        },
      });

      const inpaintRequest = await prisma.inpaintRequest.create({
        data: {
          id: submission.request_id,
          roomId: params.roomId,
          variantSlot: params.variantSlot,
          sourceSlot: params.sourceSlot,
          status: "IN_QUEUE",
        },
      });

      return { id: inpaintRequest.id, status: inpaintRequest.status };
    } catch (err) {
      lastError = err;
      const isRetryable =
        err instanceof Error &&
        (err.message.includes("rate limit") ||
          err.message.includes("timeout") ||
          err.message.includes("temporary") ||
          err.message.includes("service unavailable"));
      if (!isRetryable) {
        const classified = classifyIntegrationError(err, INPAINT_ERROR_COPY);
        throw new InpaintServiceError(classified);
      }
    }
  }

  const classified = classifyIntegrationError(lastError, INPAINT_ERROR_COPY);
  throw new InpaintServiceError(classified);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class InpaintValidationError extends Error {
  cause: unknown;
  constructor(error: unknown) {
    super("Validation failed");
    this.name = "InpaintValidationError";
    this.cause = error;
  }
}

export class InpaintNotFoundError extends Error {
  constructor() {
    super("Room not found");
    this.name = "InpaintNotFoundError";
  }
}

export class InpaintServiceError extends Error {
  code: string;
  retryable: boolean;
  status: number;

  constructor(classified: { error: string; message: string; retryable: boolean; code: string }) {
    super(classified.message);
    this.name = "InpaintServiceError";
    this.code = classified.code;
    this.retryable = classified.retryable;
    this.status = 500;
  }
}

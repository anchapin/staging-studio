import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fal } from "@/lib/fal";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { inpaintRequestSchema } from "@/lib/ai-route-schemas";
import { classifyIntegrationError } from "@/lib/error-classify";
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
});

type FalQueueSubmitFunction = (
  id: string,
  options: { input: Record<string, unknown> }
) => Promise<{ request_id: string }>;

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
    roomId = parsed.data.roomId;

    const room = await prisma.room.findFirst({
      where: { id: roomId, project: { userId: user.id } },
      select: { id: true, afterImageUrl: true, afterImageUrl2: true },
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

    // Fire-and-forget submit: returns as soon as the job is queued (~2s),
    // instead of holding the request open for the full generation.
    const falQueueSubmit = fal.queue.submit as FalQueueSubmitFunction;
    const submission = await falQueueSubmit(FAL_FLUX_FILL_MODEL, {
      input: buildFalFillPayload({ imageUrl, maskUrl, prompt, negativePrompt }),
    });

    // Persist the requestId → room mapping before responding so the status
    // route can attribute requests and a refresh can resume polling.
    await prisma.inpaintRequest.create({
      data: {
        id: submission.request_id,
        roomId: room.id,
        variantSlot,
        sourceSlot,
        status: "IN_QUEUE",
      },
    });

    return NextResponse.json({ requestId: submission.request_id });
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

import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiModel } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { generateCopyRequestSchema } from "@/lib/ai-route-schemas";
import { buildCopyPrompt } from "@/lib/prompts";
import { checklistItemSchema } from "@/lib/checklist-schema";
import { classifyIntegrationError } from "@/lib/error-classify";
import { describeNoObjectGeneratedError } from "@/lib/no-object-error";
import { saveRoomCopy, type GeneratedCopy } from "@/app/actions/room";

const COPY_OUTPUT_ERROR_COPY = {
  rateLimit: {
    error: "Rate limit exceeded",
    message: "The AI service is temporarily busy. Please wait a moment and try again.",
  },
  auth: {
    error: "Configuration error",
    message: "The AI service is not properly configured. Please contact support.",
  },
  timeout: {
    error: "Request timeout",
    message: "The AI took too long to generate copy. Please try again.",
  },
  unknown: {
    error: "Generation failed",
    message: "We couldn't generate the staging copy. Please try again.",
  },
};

const CopyOutputSchema = z.object({
  observedChallenge: z.string(),
  recommendation: z.string(),
  buyerPsychology: z.string(),
  checklist: z.array(checklistItemSchema),
});

export async function POST(request: NextRequest) {
  // Hoisted so the catch block can correlate failures with the room even
  // when the error fires before/after the request body is parsed.
  let roomId: string | undefined;
  try {
    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
          message: "You must be signed in to generate copy.",
        },
        { status: 401 }
      );
    }

    const { roomId: parsedRoomId } = generateCopyRequestSchema.parse(
      await request.json()
    );
    roomId = parsedRoomId;

    // Ownership filter follows the server-action convention
    // (`getOwnedRoomWhere` in `app/actions/room.ts`): a roomId owned by
    // another user matches nothing, so a foreign room is indistinguishable
    // from a missing one and both return 404.
    const room = await prisma.room.findFirst({
      where: { id: roomId, project: { userId: user.id } },
      include: {
        project: { select: { stagingAesthetic: true, targetBuyer: true } },
      },
    });
    if (!room) {
      return NextResponse.json(
        {
          success: false,
          error: "Room not found",
          message: "Room not found.",
        },
        { status: 404 }
      );
    }

    if (!room.rawDirectives?.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing staging directives",
          message:
            "This room has no staging directives yet. Add directives before generating copy.",
        },
        { status: 400 }
      );
    }

    const { object: copy, finishReason, usage } = await generateObject({
      model: aiModel,
      schema: CopyOutputSchema,
      prompt: buildCopyPrompt({
        roomName: room.name,
        aesthetic: room.project.stagingAesthetic,
        targetBuyer: room.project.targetBuyer,
        rawDirectives: room.rawDirectives,
      }),
    });

    const generatedCopy: GeneratedCopy = {
      observedChallenge: copy.observedChallenge,
      recommendation: copy.recommendation,
      buyerPsychology: copy.buyerPsychology,
      checklist: copy.checklist,
    };

    const saveResult = await saveRoomCopy(roomId, generatedCopy);
    if (!saveResult.success) {
      // The copy was generated (and paid for) but persistence failed.
      // Return it under a distinct `save_failed` code so the client can
      // retry save-only instead of paying to regenerate.
      console.error(
        JSON.stringify({
          event: "generate_copy_save_failed",
          roomId,
          saveError: saveResult.error ?? null,
        })
      );
      return NextResponse.json(
        {
          success: false,
          error: "save_failed",
          message: "Copy was generated but could not be saved. Please try again.",
          retryable: true,
          copy: generatedCopy,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: generatedCopy,
        finishReason,
        usage,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      JSON.stringify({ event: "generate_copy_failed", roomId: roomId ?? null }),
      error
    );

    // A NoObjectGeneratedError means the model finished but its output
    // could not be parsed into the schema. Its `.cause`/finishReason/text
    // are the only way to diagnose recurring malformed-JSON incidents, so
    // surface them in the structured log payload.
    const noObjectFields = describeNoObjectGeneratedError(error);
    if (noObjectFields) {
      console.error(
        JSON.stringify({
          event: "generate_copy_no_object_generated",
          roomId: roomId ?? null,
          ...noObjectFields,
        }),
        error
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request",
          message: "Some required information is missing or invalid. Please check your inputs.",
        },
        { status: 400 }
      );
    }

    const classified = classifyIntegrationError(error, COPY_OUTPUT_ERROR_COPY);

    return NextResponse.json(
      {
        success: false,
        error: classified.error,
        message: classified.message,
        retryable: classified.retryable,
      },
      { status: classified.status }
    );
  }
}

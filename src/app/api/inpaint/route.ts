import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  inpaintSubmitSchema,
  checkDailyQuota,
  classifyInpaintError,
  validateInpaintRoom,
  submitInpaintRequest,
} from "@/lib/inpaint-submit";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be signed in to start inpainting." },
        { status: 401 }
      );
    }

    const quotaResult = await checkDailyQuota(user.id);
    if (!quotaResult.allowed) {
      console.warn(
        JSON.stringify({
          event: "inpaint_daily_quota_exceeded",
          userId: user.id,
          used: quotaResult.currentUsage,
          limit: quotaResult.dailyLimit,
        })
      );
      return NextResponse.json(
        { ...quotaResult.payload, message: "Please try again tomorrow." },
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

    const { roomId, sourceSlot: rawSourceSlot } = parsed.data;
    const sourceSlot = rawSourceSlot ?? null;

    const roomValidation = await validateInpaintRoom(roomId, user.id, sourceSlot);
    if (roomValidation.error || !roomValidation.room) {
      return NextResponse.json(
        {
          error: roomValidation.room ? "Invalid source" : "Room not found",
          message: roomValidation.error ?? "Unexpected error",
        },
        { status: roomValidation.status }
      );
    }

    const { qualityWarnings, requestId, recordDegraded } = await submitInpaintRequest(
      roomValidation.room,
      {
        imageUrl: parsed.data.imageUrl,
        maskUrl: parsed.data.maskUrl,
        aesthetic: parsed.data.aesthetic,
        promptDirectives: parsed.data.promptDirectives,
        negativePrompt: parsed.data.negativePrompt,
        promptStrength: parsed.data.promptStrength,
        maskBlur: parsed.data.maskBlur,
        seed: parsed.data.seed,
        creativeMode: parsed.data.creativeMode,
        maskCoverageRatio: parsed.data.maskCoverageRatio,
        variantSlot: parsed.data.variantSlot,
        sourceSlot,
      }
    );

    return NextResponse.json({
      requestId,
      qualityWarnings,
      ...(recordDegraded ? { degraded: true } : {}),
    });
  } catch (error) {
    const classified = classifyInpaintError(error);
    return NextResponse.json(
      { error: classified.error, message: classified.message, retryable: classified.retryable, code: classified.code },
      { status: classified.status }
    );
  }
}

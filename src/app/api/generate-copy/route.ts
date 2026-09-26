import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiModel, assertOpenAIConfigured, generateWithCircuitBreaker } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import {
  getAuthedPrismaUser,
  requireProjectOwnership,
  ProjectNotFoundError,
  ProjectForbiddenError,
} from "@/lib/api-auth";
import {
  generateCopyRequestSchema,
  copyQualityGateSchema,
} from "@/lib/ai-route-schemas";
import { buildCopyPrompt } from "@/lib/prompts";
import { checklistItemSchema } from "@/lib/checklist-schema";
import { classifyIntegrationError } from "@/lib/error-classify";
import { describeNoObjectGeneratedError } from "@/lib/no-object-error";
import { sanitizePromptValue } from "@/lib/sanitize-prompt";
import {
  DEFAULT_DAILY_COPY_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  evaluateDailyQuota,
  getDailyUsage,
  recordDailyUsage,
  resolveDailyLimit,
} from "@/lib/api-quota";
import { saveRoomCopy, type GeneratedCopy } from "@/app/actions/room";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_ROOM_NOT_FOUND,
  API_ERROR_SAVE_FAILED,
} from "@/lib/api-errors";

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
          code: API_ERROR_UNAUTHORIZED,
        },
        { status: 401 }
      );
    }

    // Issue #201: daily per-user OpenAI cost guardrail, checked BEFORE any
    // validation or DB work — a user at their cap never reaches gpt-4o-mini.
    // Usage lives in the in-process daily counter (lib/api-quota.ts), which
    // resets on cold start; that under-count limitation is documented there.
    const copyLimit = resolveDailyLimit(
      process.env[DAILY_LIMIT_ENV_VAR.copy],
      DEFAULT_DAILY_COPY_LIMIT
    );
    const copyQuota = evaluateDailyQuota(
      await getDailyUsage("copy", user.id),
      copyLimit
    );
    if (!copyQuota.allowed) {
      console.warn(
        JSON.stringify({
          event: "generate_copy_daily_quota_exceeded",
          userId: user.id,
          used: copyQuota.used,
          limit: copyQuota.limit,
        })
      );
      return NextResponse.json(
        {
          success: false,
          ...dailyQuotaExceededPayload(copyQuota, "Please try again tomorrow."),
          code: API_ERROR_RATE_LIMIT_EXCEEDED,
        },
        { status: 429 }
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
    const roomBasic = await prisma.room.findFirst({
      where: { id: roomId },
      select: { id: true, projectId: true },
    });
    if (!roomBasic) {
      return NextResponse.json(
        {
          success: false,
          error: "Room not found",
          message: "Room not found.",
          code: API_ERROR_ROOM_NOT_FOUND,
        },
        { status: 404 }
      );
    }
    try {
      await requireProjectOwnership(roomBasic.projectId, user);
    } catch (e) {
      if (e instanceof ProjectNotFoundError) {
        return NextResponse.json(
          { success: false, error: "Project not found", message: "Project not found.", code: API_ERROR_ROOM_NOT_FOUND },
          { status: 404 }
        );
      }
      if (e instanceof ProjectForbiddenError) {
        return NextResponse.json(
          { success: false, error: "Forbidden", message: "Forbidden." },
          { status: 403 }
        );
      }
      throw e;
    }
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        project: {
          select: {
            stagingAesthetic: true,
            targetBuyer: true,
            stagingDirectives: true,
            buyerDemographics: true,
          },
        },
      },
    });
    if (!room) {
      return NextResponse.json(
        { success: false, error: "Room not found", message: "Room not found.", code: API_ERROR_ROOM_NOT_FOUND },
        { status: 404 }
      );
    }

    // Issue #562: allow copy generation if either room or global directives exist
    const hasDirectives =
      room.rawDirectives?.trim() || room.project.stagingDirectives?.trim();
    if (!hasDirectives) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing staging directives",
          message: "Add staging directives at the project or room level before generating copy.",
          code: API_ERROR_INVALID_REQUEST,
        },
        { status: 400 }
      );
    }

    const { object: copy, finishReason, usage } = await generateWithCircuitBreaker(async () =>
      generateObject({
        model: aiModel,
        schema: CopyOutputSchema,
        prompt: buildCopyPrompt({
          roomName: room.name,
          aesthetic: room.project.stagingAesthetic,
          targetBuyer: room.project.targetBuyer,
          rawDirectives: room.rawDirectives ?? "",
          globalDirectives: room.project.stagingDirectives ?? undefined,
          buyerDemographics: (
            room.project.buyerDemographics as unknown as import("@/lib/prompts").BuyerDemographicsInput | undefined
          ) ?? undefined,
        }),
      })
    );

    // Count the billable generation only after the provider call resolves:
    // a failed/timeout attempt costs at most a few rejected tokens and does
    // not count against the user's daily cap.
    await recordDailyUsage("copy", user.id);

    // Issue #600: copy quality gate — evaluate generated copy quality before
    // persisting. Advisory only; warnings ride along with the saved copy.
    const qualityWarnings: string[] = [];
    assertOpenAIConfigured();
    const { object: qg } = await generateWithCircuitBreaker(async () =>
      generateObject({
        model: aiModel,
        schema: copyQualityGateSchema,
        messages: [
          {
            role: "user",
            content: [
              `You are a staging copy quality auditor. Evaluate the generated copy for room "${sanitizePromptValue(room.name)}".`,
              "",
              `Staging aesthetic: "${sanitizePromptValue(room.project.stagingAesthetic)}"`,
              `Target buyer: "${sanitizePromptValue(room.project.targetBuyer)}"`,
              `Raw directives: "${sanitizePromptValue(room.rawDirectives ?? "")}"`,
              "",
              `Generated copy:`,
              `  Observed challenge: "${copy.observedChallenge}"`,
              `  Recommendation: "${copy.recommendation}"`,
              `  Buyer psychology: "${copy.buyerPsychology}"`,
              `  Checklist: ${copy.checklist.map((c) => `"${c.item}"`).join(", ")}`,
              "",
              "Evaluate:",
              "1. specificity (0–3): 0=generic/filler like 'Attention to detail ensures lasting impressions', 3=highly specific and concrete",
              "2. buyer_aligned: if the copy doesn't speak to the target buyer persona, explain how",
              "3. checklist_actionable: if any checklist item is vague, non-actionable, or generic",
              "4. aesthetic_consistent: if copy contradicts or misaligns with the staging aesthetic",
              "",
              "Return JSON with: specificity (0-3), buyer_aligned (string only if misaligned), checklist_actionable (string only if vague items), aesthetic_consistent (string only if inconsistent), qualityWarnings (array of distinct warning strings).",
            ].join("\n"),
          },
        ],
      })
    );
    if (qg.buyer_aligned) {
      qualityWarnings.push(qg.buyer_aligned);
    }
    if (qg.checklist_actionable) {
      qualityWarnings.push(qg.checklist_actionable);
    }
    if (qg.aesthetic_consistent) {
      qualityWarnings.push(qg.aesthetic_consistent);
    }
    if (qg.qualityWarnings) {
      qualityWarnings.push(...qg.qualityWarnings);
    }

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
          qualityWarnings,
          code: API_ERROR_SAVE_FAILED,
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
        qualityWarnings,
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
          code: API_ERROR_INVALID_REQUEST,
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
        code: classified.code,
      },
      { status: classified.status }
    );
  }
}

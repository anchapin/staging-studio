import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  FALLBACK_MODEL_ID,
  FALLBACK_PRIMARY_ID,
  aiModel,
  assertOpenAIConfigured,
  generateWithCircuitBreaker,
  generateWithFailover,
} from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import {
  getAuthedPrismaUser,
  requireProjectOwnershipOrThrow,
  ProjectNotFoundError,
  ProjectForbiddenError,
} from "@/lib/api-auth";
import {
  generateCopyRequestSchema,
  copyQualityGateSchema,
} from "@/lib/ai-route-schemas";
import { buildCopyPrompt } from "@/lib/prompts";
import { checklistItemSchema } from "@/lib/checklist-schema";
import { classifyIntegrationError, classifyIntegrationErrorClass } from "@/lib/error-classify";
import { withRequestLogging } from "@/lib/api-logging";
import { logger } from "@/lib/logger";
import { describeNoObjectGeneratedError } from "@/lib/no-object-error";
import { sanitizePromptValue } from "@/lib/sanitize-prompt";
import {
  DEFAULT_DAILY_COPY_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  claimDailyQuota,
  refundDailyQuota,
  resolveDailyLimit,
} from "@/lib/api-quota";
import type { QuotaClaim } from "@/lib/api-quota";
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

async function postGenerateCopy(request: NextRequest) {
  // Hoisted so the catch block can correlate failures with the room even
  // when the error fires before/after the request body is parsed.
  let roomId: string | undefined;
  // Issue #1132: per-request record of the atomic quota claim and whether
  // the provider call resolved, so the catch below refunds the claim only
  // when the paid call itself failed (a failure after it resolved, e.g.
  // persisting the copy, keeps the count — the same accounting as the old
  // charge-after-resolve).
  let copyUserId: string | undefined;
  let copyClaim: QuotaClaim | null = null;
  let copyGenerationResolved = false;
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

    copyUserId = user.id;

    // Issue #201: daily per-user OpenAI cost guardrail. Usage lives in the
    // `DailyApiUsage` Postgres table, so it survives serverless cold starts
    // and multi-instance traffic splitting (issues #784, #1131). #1132: the
    // unit is claimed ATOMICALLY just before the paid call (below), not
    // gate-read up front — the old check-then-charge let a concurrent burst
    // all read the same pre-spend count and overshoot the cap. A user at
    // their cap still never reaches gpt-4o-mini.
    const copyLimit = resolveDailyLimit(
      process.env[DAILY_LIMIT_ENV_VAR.copy],
      DEFAULT_DAILY_COPY_LIMIT
    );

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
      await requireProjectOwnershipOrThrow(roomBasic.projectId, user);
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

    // Issue #201/#1132: claim one copy unit ATOMICALLY here, on the eve of
    // the paid call. The conditional increment (UPDATE ... WHERE count <=
    // limit - N) is serialized by Postgres, so a concurrent burst can no
    // longer all read the same pre-spend count and all reach gpt-4o-mini;
    // losers get 429 with the same payload shape as before.
    copyClaim = await claimDailyQuota("copy", user.id, copyLimit);
    if (!copyClaim.claimed) {
      console.warn(
        JSON.stringify({
          event: "generate_copy_daily_quota_exceeded",
          userId: user.id,
          used: copyClaim.used,
          limit: copyClaim.limit,
        })
      );
      return NextResponse.json(
        {
          success: false,
          ...dailyQuotaExceededPayload(copyClaim, "Please try again tomorrow."),
          code: API_ERROR_RATE_LIMIT_EXCEEDED,
        },
        { status: 429 }
      );
    }

    // Issue #1224: the generation call runs through the failover wrapper —
    // a vendor-availability failure on the primary (rate limit, timeout,
    // network) gets exactly one attempt on the fallback model. The quality
    // gate below deliberately stays on the primary via the breaker.
    const { result: generation, modelId, failedOver } = await generateWithFailover(
      (model) =>
        generateObject({
          model,
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
        repairText: async ({ text }) => {
          const trimmed = text.trim();
          const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
          if (!jsonMatch) return null;
          const extracted = jsonMatch[0];
          try {
            JSON.parse(extracted);
            return extracted;
          } catch {
            const fixed = extracted
              .replace(/,\s*([}\]])/g, "$1")
              .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
              .replace(/:\s*'([^']*)'/g, ': "$1"');
            try {
              JSON.parse(fixed);
              return fixed;
            } catch {
              return null;
            }
          }
        },
      })
    );
    const { object: copy, finishReason, usage } = generation;
    copyGenerationResolved = true;

    // No charge is written here: the unit was claimed atomically before
    // the call (issue #1132), and a failed/timeout attempt is refunded in
    // the catch below, so it still costs nothing against the daily cap.

    // Issue #600: copy quality gate — evaluate generated copy quality before
    // persisting. Advisory only; warnings ride along with the saved copy.
    const qualityWarnings: string[] = [];
    assertOpenAIConfigured();
    // Issue #1224: the gate is advisory, so a gate failure must never turn
    // an already-generated copy (including one the fallback just produced
    // during an availability incident) into a failed request.
    let qg: z.infer<typeof copyQualityGateSchema> | null = null;
    try {
      qg = (
        await generateWithCircuitBreaker(async () =>
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
        )
      ).object;
    } catch (gateError) {
      logger.warn(
        {
          event: "generate_copy_quality_gate_failed",
          roomId,
          errorClass: classifyIntegrationErrorClass(gateError),
        },
        `[generate-copy] quality gate skipped: ${gateError instanceof Error ? gateError.message : String(gateError)}`
      );
    }
    if (qg?.buyer_aligned) {
      qualityWarnings.push(qg.buyer_aligned);
    }
    if (qg?.checklist_actionable) {
      qualityWarnings.push(qg.checklist_actionable);
    }
    if (qg?.aesthetic_consistent) {
      qualityWarnings.push(qg.aesthetic_consistent);
    }
    if (qg?.qualityWarnings) {
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

    // Issue #1224: `model` names the tier that produced the copy (primary
    // or fallback) so per-model spend can be attributed from the response;
    // `usage` is that model's own usage object.
    if (failedOver) {
      console.warn(
        JSON.stringify({
          event: "generate_copy_failover",
          roomId,
          primaryModel: FALLBACK_PRIMARY_ID,
          fallbackModel: FALLBACK_MODEL_ID,
        })
      );
    }
    return NextResponse.json(
      {
        success: true,
        data: generatedCopy,
        finishReason,
        usage,
        model: modelId,
        qualityWarnings,
      },
      { status: 200 }
    );
  } catch (error) {
    // Issue #1132: give the claimed unit back when the paid call itself
    // failed. Once it resolved, the count stands even if a later step
    // (persisting the copy) throws — the vision/generation work was
    // consumed.
    if (!copyGenerationResolved && copyUserId && copyClaim?.claimed) {
      await refundDailyQuota("copy", copyUserId);
    }
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

// Issue #1116: wire the request logger so this route actually logs.
export const POST = withRequestLogging(postGenerateCopy);

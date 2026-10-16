/**
 * v1 Listing Copy Route (issue #1343).
 *
 * Rate-limited and ownership-checked gpt-4o-mini copy route that
 * powers the `<CopyPanel>` ("Listing copy" tab) "Rewrite from
 * directions" CTA. The response shape is `{ headline, body }` —
 * exactly the two columns the panel persists through `saveListingCopy`.
 *
 * POST /api/v1/listing-copy  { roomId: string }
 *
 * Distinguishing this route from the legacy `/api/generate-copy` /
 * stub `/api/v1/generate-copy`:
 *  - Those generate the four staging-copy fields
 *    (`observedChallenge`, `recommendation`, `buyerPsychology`,
 *    `checklist`) consumed by the consultation report.
 *  - This route generates the lookbook listing copy (`headline`,
 *    `body`) consumed by the room-spread listing-copy strip.
 *  - Same model (gpt-4o-mini), same daily quota (`DAILY_COPY_LIMIT`,
 *    surfaced as `copy` in `lib/api-quota.ts`), same auth + ownership
 *    + atomic-claim shape — just different fields.
 *
 * Version header: X-Supabase-API-Version: v1.
 */
import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";

import {
  FALLBACK_MODEL_ID,
  FALLBACK_PRIMARY_ID,
  assertOpenAIConfigured,
  generateWithFailover,
} from "@/lib/ai";
import {
  listingCopyRequestSchema,
  listingCopyOutputSchema,
} from "@/lib/ai-route-schemas";
import {
  getAuthedPrismaUser,
  ProjectForbiddenError,
  ProjectNotFoundError,
  requireProjectOwnershipOrThrow,
} from "@/lib/api-auth";
import {
  DEFAULT_DAILY_COPY_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  claimDailyQuota,
  refundDailyQuota,
  resolveDailyLimit,
} from "@/lib/api-quota";
import type { QuotaClaim } from "@/lib/api-quota";
import {
  API_ERROR_INVALID_REQUEST,
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_ROOM_NOT_FOUND,
  API_ERROR_UNAUTHORIZED,
} from "@/lib/api-errors";
import { classifyIntegrationError, classifyIntegrationErrorClass } from "@/lib/error-classify";
import { withRequestLogging } from "@/lib/api-logging";
import { logger } from "@/lib/logger";
import { describeNoObjectGeneratedError } from "@/lib/no-object-error";
import { prisma } from "@/lib/prisma";
import { buildListingCopyPrompt } from "@/lib/prompts";
import { buildVersionHeaders } from "@/lib/api-version";

const LISTING_COPY_ERROR_COPY = {
  rateLimit: {
    error: "Rate limit exceeded",
    message:
      "The AI service is temporarily busy. Please wait a moment and try again.",
  },
  auth: {
    error: "Configuration error",
    message:
      "The AI service is not properly configured. Please contact support.",
  },
  timeout: {
    error: "Request timeout",
    message: "The AI took too long to generate copy. Please try again.",
  },
  unknown: {
    error: "Generation failed",
    message:
      "We couldn't rewrite the listing copy. Please try again.",
  },
};

async function postListingCopy(request: NextRequest) {
  const versionInfo = buildVersionHeaders("v1");

  // Hoisted so the catch block can correlate failures with the room
  // even when the error fires before/after the request body is parsed.
  let roomId: string | undefined;
  // Issue #1132: per-request record of the atomic quota claim and
  // whether the provider call resolved, so the catch below refunds
  // the claim only when the paid call itself failed (a failure
  // after it resolved, e.g. parsing the model output, keeps the
  // count — same accounting as `/api/generate-copy`).
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
          message: "You must be signed in to rewrite listing copy.",
          code: API_ERROR_UNAUTHORIZED,
        },
        { status: 401, headers: versionInfo }
      );
    }

    copyUserId = user.id;

    // Issue #201 / #1132: per-request daily copy limit. The surface
    // is "copy" — the same counter `/api/generate-copy` charges —
    // because both are gpt-4o-mini copy generation for the same
    // user. Claiming atomically below (not on a check-then-charge)
    // closes the concurrent-burst overshoot the old shape allowed.
    const copyLimit = resolveDailyLimit(
      process.env[DAILY_LIMIT_ENV_VAR.copy],
      DEFAULT_DAILY_COPY_LIMIT
    );

    const parsed = listingCopyRequestSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request",
          message: "Some required information is missing or invalid. Please check your inputs.",
          code: API_ERROR_INVALID_REQUEST,
        },
        { status: 400, headers: versionInfo }
      );
    }
    roomId = parsed.data.roomId;

    // Ownership check follows the server-action convention
    // (`getOwnedRoomWhere` in `app/actions/room.ts`): a roomId owned
    // by another user matches nothing, so a foreign room is
    // indistinguishable from a missing one and both return 404.
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
        { status: 404, headers: versionInfo }
      );
    }
    try {
      await requireProjectOwnershipOrThrow(roomBasic.projectId, user);
    } catch (e) {
      if (e instanceof ProjectNotFoundError) {
        return NextResponse.json(
          {
            success: false,
            error: "Project not found",
            message: "Project not found.",
            code: API_ERROR_ROOM_NOT_FOUND,
          },
          { status: 404, headers: versionInfo }
        );
      }
      if (e instanceof ProjectForbiddenError) {
        return NextResponse.json(
          {
            success: false,
            error: "Forbidden",
            message: "Forbidden.",
          },
          { status: 403, headers: versionInfo }
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
          },
        },
      },
    });
    if (!room) {
      return NextResponse.json(
        {
          success: false,
          error: "Room not found",
          message: "Room not found.",
          code: API_ERROR_ROOM_NOT_FOUND,
        },
        { status: 404, headers: versionInfo }
      );
    }

    // Issue #562: allow listing-copy rewrite if either room or
    // global directives exist — same gate as `/api/generate-copy`,
    // because the rewrite brief is the same staging intent.
    const hasDirectives =
      room.rawDirectives?.trim() || room.project.stagingDirectives?.trim();
    if (!hasDirectives) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing staging directives",
          message:
            "Add staging directives at the project or room level before rewriting the listing copy.",
          code: API_ERROR_INVALID_REQUEST,
        },
        { status: 400, headers: versionInfo }
      );
    }

    // Issue #201/#1132: claim one copy unit ATOMICALLY here, on the
    // eve of the paid call. The conditional increment (UPDATE ...
    // WHERE count <= limit - N) is serialized by Postgres, so a
    // concurrent burst can no longer all read the same pre-spend
    // count and all reach gpt-4o-mini; losers get 429 with the same
    // payload shape as before.
    copyClaim = await claimDailyQuota("copy", user.id, copyLimit);
    if (!copyClaim.claimed) {
      console.warn(
        JSON.stringify({
          event: "v1_listing_copy_daily_quota_exceeded",
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
        { status: 429, headers: versionInfo }
      );
    }

    // Issue #1224: the generation call runs through the failover
    // wrapper — a vendor-availability failure on the primary (rate
    // limit, timeout, network) gets exactly one attempt on the
    // fallback model. The AI SDK's `generateObject` parses the
    // model output through `ListingOutputSchema`; a structured-
    // output failure surfaces as `NoObjectGeneratedError`, which the
    // catch block classifies below (same accounting as the legacy
    // generate-copy route).
    assertOpenAIConfigured();
    const { result: generation, modelId, failedOver } =
      await generateWithFailover((model) =>
        generateObject({
          model,
          schema: listingCopyOutputSchema,
          prompt: buildListingCopyPrompt({
            roomName: room.name,
            aesthetic: room.project.stagingAesthetic,
            targetBuyer: room.project.targetBuyer,
            rawDirectives: room.rawDirectives ?? "",
            globalDirectives: room.project.stagingDirectives ?? undefined,
            // The room's currently-stored headline (possibly
            // user-edited) feeds the rewrite so a re-rewrite keeps
            // the same framing unless the directives changed.
            priorHeadline: room.lookbookHeadline ?? undefined,
          }),
        })
      );
    const { object: copy, finishReason, usage } = generation;
    copyGenerationResolved = true;

    // Issue #1343: the response shape is exactly the two columns the
    // CopyPanel persists through `saveListingCopy`. Validate through
    // the same schema the AI SDK used, then return — a structural
    // mismatch (e.g. model produced a non-string `headline`) lands in
    // the catch block via `NoObjectGeneratedError` and refunds the
    // quota claim.
    const out = listingCopyOutputSchema.parse(copy);

    if (failedOver) {
      console.warn(
        JSON.stringify({
          event: "v1_listing_copy_failover",
          roomId,
          primaryModel: FALLBACK_PRIMARY_ID,
          fallbackModel: FALLBACK_MODEL_ID,
        })
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: out,
        finishReason,
        usage,
        model: modelId,
      },
      { status: 200, headers: versionInfo }
    );
  } catch (error) {
    // Issue #1132: give the claimed unit back when the paid call
    // itself failed. Once it resolved, the count stands even if a
    // later step (parsing the model output) throws — the
    // generation work was consumed.
    if (!copyGenerationResolved && copyUserId && copyClaim?.claimed) {
      await refundDailyQuota("copy", copyUserId);
    }
    console.error(
      JSON.stringify({
        event: "v1_listing_copy_failed",
        roomId: roomId ?? null,
      }),
      error
    );

    // A NoObjectGeneratedError means the model finished but its
    // output could not be parsed into the schema. Its
    // `.cause`/finishReason/text are the only way to diagnose
    // recurring malformed-JSON incidents, so surface them in the
    // structured log payload (same pattern as `/api/generate-copy`).
    const noObjectFields = describeNoObjectGeneratedError(error);
    if (noObjectFields) {
      console.error(
        JSON.stringify({
          event: "v1_listing_copy_no_object_generated",
          roomId: roomId ?? null,
          ...noObjectFields,
        }),
        error
      );
    }

    // The classifier needs an error; fall back to the unversioned
    // shape via ZodError when the schema-parse step fails.
    const classified = classifyIntegrationError(error, LISTING_COPY_ERROR_COPY);
    logger.warn(
      {
        event: "v1_listing_copy_classified",
        roomId,
        errorClass: classifyIntegrationErrorClass(error),
      },
      `[v1/listing-copy] ${classified.error}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return NextResponse.json(
      {
        success: false,
        error: classified.error,
        message: classified.message,
        retryable: classified.retryable,
        code: classified.code,
      },
      { status: classified.status, headers: versionInfo }
    );
  }
}

// Issue #1116: wire the request logger so this route actually logs.
export const POST = withRequestLogging(postListingCopy);
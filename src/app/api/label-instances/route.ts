import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getAuthedPrismaUser,
  requireProjectOwnershipOrThrow,
  ProjectNotFoundError,
  ProjectForbiddenError,
} from "@/lib/api-auth";
import { aiModel, assertOpenAIConfigured, generateWithCircuitBreaker } from "@/lib/ai";
import {
  visionLabelRequestSchema,
  visionLabelOutputSchema,
} from "@/lib/ai-route-schemas";
import {
  getCachedVisionLabels,
  upsertVisionLabels,
} from "@/lib/vision-labels";
import {
  DEFAULT_DAILY_LABEL_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  claimDailyQuota,
  refundDailyQuota,
  resolveDailyLimit,
} from "@/lib/api-quota";
import type { QuotaClaim } from "@/lib/api-quota";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_ROOM_NOT_FOUND,
  API_ERROR_INTERNAL_SERVER,
} from "@/lib/api-errors";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { sanitizePromptValue } from "@/lib/sanitize-prompt";

export const POST = withErrorHandler(async (request: NextRequest) => {
  const user = await getAuthedPrismaUser();
  if (!user) {
    throw new ApiError({
      code: API_ERROR_UNAUTHORIZED,
      message: "You must be signed in to label instances.",
      status: 401,
    });
  }

  const parsed = visionLabelRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new ApiError({
      code: API_ERROR_INVALID_REQUEST,
      message: "Some required information is missing or invalid.",
      status: 400,
      details: parsed.error.issues,
    });
  }

  const { roomId, concept: rawConcept, crops, imageUrl } = parsed.data;
  const concept = sanitizePromptValue(rawConcept);

  // #1144: the cap tracks vision inputs actually sent, one unit per
  // crop. #1132: the units are claimed ATOMICALLY just before the paid
  // call (below, after the cached short-circuit), not gate-read up
  // front, so a concurrent burst can no longer all read the same
  // pre-spend count and overshoot the cap.
  const labelLimit = resolveDailyLimit(
    process.env[DAILY_LIMIT_ENV_VAR.label],
    DEFAULT_DAILY_LABEL_LIMIT
  );

  const room = await prisma.room.findFirst({
    where: { id: roomId },
    select: { id: true, projectId: true },
  });
  if (!room) {
    throw new ApiError({
      code: API_ERROR_ROOM_NOT_FOUND,
      message: "The requested room could not be found.",
      status: 404,
    });
  }
  try {
    await requireProjectOwnershipOrThrow(room.projectId, user);
  } catch (e) {
    if (e instanceof ProjectNotFoundError) {
      throw new ApiError({ code: API_ERROR_ROOM_NOT_FOUND, message: "Project not found.", status: 404 });
    }
    if (e instanceof ProjectForbiddenError) {
      throw new ApiError({ code: "forbidden", message: "Forbidden.", status: 403 });
    }
    throw e;
  }

  assertOpenAIConfigured();

  const instanceIndices = crops.map((c: { instanceIndex: number }) => c.instanceIndex);
  const cached = await getCachedVisionLabels({ imageUrl, concept, instanceIndices, userId: user.id });
  if (cached.length > 0) {
    const labels = cached.map((row: { instanceIndex: number; label: string }) => ({
      instanceIndex: row.instanceIndex,
      label: row.label,
    }));
    return NextResponse.json({ success: true, labels }, { status: 200 });
  }

  const cropsWithBytes = crops.map((crop: { instanceIndex: number; cropDataUrl: string }) => ({
    instanceIndex: crop.instanceIndex,
    base64: crop.cropDataUrl.slice(crop.cropDataUrl.indexOf(",") + 1),
  }));

  // Issue #1132: claim one unit per crop ATOMICALLY on the eve of the
  // paid OpenAI call. The conditional increment is serialized by
  // Postgres, so only headroom-sized claims land; losers get 429 with
  // the same message as before. Sits after the cached short-circuit so
  // a cache hit consumes no units (the #1144 rule). A generation
  // failure refunds the claim in the catch below; a failure persisting
  // labels afterwards keeps the charge (the vision work was consumed).
  const labelClaim: QuotaClaim = await claimDailyQuota(
    "label",
    user.id,
    labelLimit,
    crops.length
  );
  if (!labelClaim.claimed) {
    console.warn(
      JSON.stringify({
        event: "label_instances_daily_quota_exceeded",
        userId: user.id,
        used: labelClaim.used,
        limit: labelClaim.limit,
        crops: crops.length,
      })
    );
    throw new ApiError({
      code: API_ERROR_RATE_LIMIT_EXCEEDED,
      message: dailyQuotaExceededPayload(labelClaim, "Please try again tomorrow.").message,
      status: 429,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let object: any;
  try {
    const result = await generateWithCircuitBreaker(async () =>
      generateObject({
        model: aiModel,
        schema: visionLabelOutputSchema,
        messages: [
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const,
                text: [
                  `A room photo was scanned for "${concept}" instances.`,
                  "Numbered crops of each detected instance follow, in detection order.",
                  "Name each crop with a short, specific interior-design noun phrase",
                  '(e.g. "accent chair", "coffee table"). Keep labels under 6 words.',
                  "If a crop is ambiguous, use the most likely furniture name.",
                  `Respond with one label per instance index (${crops
                    .map((crop: { instanceIndex: number }) => crop.instanceIndex)
                    .join(", ")}).`,
                ].join(" "),
              },
              ...cropsWithBytes.map((crop) => ({
                type: "file" as const,
                mediaType: "image/jpeg" as const,
                data: crop.base64,
              })),
            ],
          },
        ],
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    object = result.object as any;
  } catch (error) {
    // Issue #1132: give the claimed units back when generation fails, so
    // a failed attempt costs the user nothing (the pre-#1132 behavior).
    if (labelClaim.claimed) {
      await refundDailyQuota("label", user.id, crops.length);
    }
    console.error(
      JSON.stringify({
        event: "label_instances_generation_error",
        error: error instanceof Error ? error.message : String(error),
      }),
      error
    );
    throw new ApiError({
      code: API_ERROR_INTERNAL_SERVER,
      message: "Could not label the detected instances. Please try again.",
    });
  }

  const requested = new Set(crops.map((crop: { instanceIndex: number }) => crop.instanceIndex));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labels = (object as any).labels.filter((entry: { instanceIndex: number }) =>
    requested.has(entry.instanceIndex)
  );

  // No charge is written here: the per-crop units were claimed
  // atomically before the call (issue #1132).

  if (labels.length > 0) {
    await upsertVisionLabels({
      imageUrl,
      concept,
      results: labels.map(
        (l: { instanceIndex: number; label: string }) => ({
          instanceIndex: l.instanceIndex,
          label: l.label,
        })
      ),
      userId: user.id,
      roomId,
    });
  }

  return NextResponse.json({ success: true, labels }, { status: 200 });
});

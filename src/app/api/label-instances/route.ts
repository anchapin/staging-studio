import { NextRequest, NextResponse } from "next/server";

import { getAuthedPrismaUser } from "@/lib/api-auth";
import { ApiError } from "@/lib/api-error-handler";
import {
  API_ERROR_INTERNAL_SERVER,
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_UNAUTHORIZED,
} from "@/lib/api-errors";
import { withErrorHandler } from "@/lib/api-error-handler";
import {
  claimDailyQuota,
  dailyQuotaExceededPayload,
  DEFAULT_DAILY_LABEL_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  refundDailyQuota,
  resolveDailyLimit,
} from "@/lib/api-quota";
import {
  buildLabelPromptMessages,
  defaultLabelInstancesServiceDeps,
  extractRequestedLabels,
  loadCachedLabels,
  mapCachedRowsToLabels,
  persistLabelRows,
  resolveInstanceCrops,
  runVisionLabelGeneration,
  validateLabelAccess,
} from "@/lib/label-instances-service";
import {
  visionLabelOutputSchema,
  visionLabelRequestSchema,
} from "@/lib/ai-route-schemas";

/**
 * `/api/label-instances` — runs the vision-label workflow on a room's
 * per-instance crops. The route is intentionally thin: it parses the
 * request, runs auth, claims daily quota, delegates the OpenAI call to
 * `label-instances-service`, persists results, and refunds quota on
 * generation failure. See `label-instances-service.ts` for the per-step
 * pure helpers (cache lookup, prompt build, response extraction, persistence).
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const user = await getAuthedPrismaUser();
  if (!user) {
    throw new ApiError({
      code: API_ERROR_UNAUTHORIZED,
      message: "Not authenticated.",
      status: 401,
    });
  }

  const json = await request.json();
  const parsed = visionLabelRequestSchema.parse(json);

  const {
    roomId,
    concept: rawConcept,
    imageUrl,
    crops,
  } = parsed;

  const instanceIndices = crops.map((c) => c.instanceIndex);
  const cropsWithBytes = resolveInstanceCrops(crops);

  // Access check — throws API_ERROR_ROOM_NOT_FOUND (404) or "forbidden" (403).
  await validateLabelAccess(roomId, user, defaultLabelInstancesServiceDeps());

  // Cache hit short-circuit — any cached entries return without claiming
  // quota or hitting OpenAI (per #1132). The `length > 0` predicate matches
  // the existing test contract.
  const cached = await loadCachedLabels(
    {
      imageUrl,
      concept: rawConcept,
      instanceIndices,
      userId: user.id,
    },
    defaultLabelInstancesServiceDeps(),
  );
  if (cached.length > 0) {
    return NextResponse.json(
      { success: true, labels: mapCachedRowsToLabels(cached, instanceIndices) },
      { status: 200 },
    );
  }

  // Atomic quota claim — one unit per crop. The call may overshoot the cap
  // under concurrency (#1111) but never silently misses. The route refunds
  // on the OpenAI failure path below (issue #1132).
  const labelLimit = resolveDailyLimit(
    process.env[DAILY_LIMIT_ENV_VAR.label],
    DEFAULT_DAILY_LABEL_LIMIT,
  );
  const labelClaim = await claimDailyQuota("label", user.id, labelLimit, crops.length);
  if (!labelClaim.claimed) {
    console.warn(
      JSON.stringify({
        event: "label_instances_daily_quota_exceeded",
        userId: user.id,
        used: labelClaim.used,
        limit: labelClaim.limit,
        crops: crops.length,
      }),
    );
    throw new ApiError({
      code: API_ERROR_RATE_LIMIT_EXCEEDED,
      message: dailyQuotaExceededPayload(labelClaim, "Please try again tomorrow.").message,
      status: 429,
    });
  }

  const deps = defaultLabelInstancesServiceDeps();

  // Run the OpenAI vision-label generation through the circuit breaker.
  // Errors here are caught so we can refund quota before propagating.
  try {
    const messages = buildLabelPromptMessages({
      concept: rawConcept,
      instanceIndices,
      cropsWithBytes,
    });
    const { object } = await runVisionLabelGeneration(
      { schema: visionLabelOutputSchema, messages },
      deps,
    );
    const labels = extractRequestedLabels(object, instanceIndices);

    // No charge is written here: the per-crop units were claimed atomically
    // before the call (issue #1132). The persistence is best-effort — if it
    // throws, we still respond with the labels we already have.
    await persistLabelRows(
      {
        imageUrl,
        concept: rawConcept,
        userId: user.id,
        roomId,
      },
      labels,
      deps,
    );

    return NextResponse.json({ success: true, labels }, { status: 200 });
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
      error,
    );
    throw new ApiError({
      code: API_ERROR_INTERNAL_SERVER,
      message: "Could not label the detected instances. Please try again.",
    });
  }
});
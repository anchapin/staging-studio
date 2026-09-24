import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
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
  evaluateDailyQuota,
  getDailyUsage,
  recordDailyUsage,
  resolveDailyLimit,
} from "@/lib/api-quota";

/**
 * POST /api/label-instances (issue #252 D4 / WS3).
 *
 * ONE batched GPT-4o-mini vision request that names every instance of a
 * successful billed detection. The client crops each instance from the
 * displayed source image and posts the crops here after a cache-miss
 * detection; labels are optional enrichment (rows render with the concept
 * string until this resolves, and fall back permanently on failure), so
 * the response is never the critical path of a staging run.
 *
 * Billing note: this call is OpenAI-billed and is triggered only for
 * cache-miss detections by the client — cache hits never reach this
 * route. A per-user daily label quota (issue #263) is checked before
 * any AI work; the limit is configurable via DAILY_LABEL_LIMIT.
 *
 * Issue #266: results are cached in the VisionLabel table so re-opening
 * the editor does not re-bill GPT-4o-mini.
 *
 * Contract: 401 unauthenticated; 404 when the room is not owned by the
 * caller; 400 on a schema-invalid body; 429 when the daily label quota
 * is exhausted; 500 with a classified message on provider failure. Success
 * returns `{ success: true, labels: [{ instanceIndex, label }] }` — labels
 * for instances the model could not name are simply absent (the client
 * keeps the concept fallback for those slots).
 */

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
          message: "You must be signed in to label instances.",
        },
        { status: 401 }
      );
    }

    // Issue #263: daily per-user OpenAI vision cost guardrail, checked
    // BEFORE any validation or DB work — a user at their cap never reaches
    // gpt-4o-mini. Usage lives in the in-process daily counter
    // (lib/api-quota.ts), which resets on cold start; that under-count
    // limitation is documented there.
    const labelLimit = resolveDailyLimit(
      process.env[DAILY_LIMIT_ENV_VAR.label],
      DEFAULT_DAILY_LABEL_LIMIT
    );
    const labelQuota = evaluateDailyQuota(
      await getDailyUsage("label", user.id),
      labelLimit
    );
    if (!labelQuota.allowed) {
      console.warn(
        JSON.stringify({
          event: "label_instances_daily_quota_exceeded",
          userId: user.id,
          used: labelQuota.used,
          limit: labelQuota.limit,
        })
      );
      return NextResponse.json(
        {
          success: false,
          ...dailyQuotaExceededPayload(labelQuota, "Please try again tomorrow."),
        },
        { status: 429 }
      );
    }

    const parsed = visionLabelRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request",
          message: "Some required information is missing or invalid.",
        },
        { status: 400 }
      );
    }

    const { roomId, concept, crops, imageUrl } = parsed.data;

    // Ownership: same check as the detection route — the room must belong
    // to a project owned by the authenticated user.
    const room = await prisma.room.findFirst({
      where: { id: roomId, project: { userId: user.id } },
      select: { id: true },
    });
    if (!room) {
      return NextResponse.json(
        {
          success: false,
          error: "Room not found",
          message: "The requested room could not be found.",
        },
        { status: 404 }
      );
    }

    assertOpenAIConfigured();

    // Issue #266: check the persistent cache before billing GPT-4o-mini.
    const instanceIndices = crops.map((c: { instanceIndex: number }) => c.instanceIndex);
    const cached = await getCachedVisionLabels({ imageUrl, concept, instanceIndices, userId: user.id });
    if (cached.length > 0) {
      const labels = cached.map((row: { instanceIndex: number; label: string }) => ({
        instanceIndex: row.instanceIndex,
        label: row.label,
      }));
      return NextResponse.json({ success: true, labels }, { status: 200 });
    }

    // Crop data URLs → raw base64 (the AI SDK's `file` part takes decoded
    // bytes; the deprecated `image` part is avoided).
    const cropsWithBytes = crops.map((crop: { instanceIndex: number; cropDataUrl: string }) => ({
      instanceIndex: crop.instanceIndex,
      base64: crop.cropDataUrl.slice(crop.cropDataUrl.indexOf(",") + 1),
    }));

    const { object } = await generateWithCircuitBreaker(async () =>
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

    // Keep only labels for instance indices the caller actually sent —
    // the model occasionally echoes stray indices, and the client keys labels
    // by detection-response index.
    const requested = new Set(crops.map((crop: { instanceIndex: number }) => crop.instanceIndex));
    const labels = object.labels.filter((entry: { instanceIndex: number }) =>
      requested.has(entry.instanceIndex)
    );

    // Count the billable generation only after the provider call resolves:
    // a failed/timeout attempt costs at most a few rejected tokens and does
    // not count against the user's daily cap.
    await recordDailyUsage("label", user.id);

    // Issue #266: persist successful labels so re-opening the editor skips billing.
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
  } catch (error) {
    console.error(
      JSON.stringify({ event: "label_instances_failed" }),
      error
    );
    return NextResponse.json(
      {
        success: false,
        error: "Labeling failed",
        message: "Could not label the detected instances. Please try again.",
      },
      { status: 500 }
    );
  }
}

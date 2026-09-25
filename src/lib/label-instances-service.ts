import { generateObject } from "ai";
import { prisma } from "@/lib/prisma";
import { aiModel, assertOpenAIConfigured, generateWithCircuitBreaker } from "@/lib/ai";
import { visionLabelOutputSchema } from "@/lib/ai-route-schemas";
import { getCachedVisionLabels, upsertVisionLabels } from "@/lib/vision-labels";
import {
  DEFAULT_DAILY_LABEL_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  evaluateDailyQuota,
  getDailyUsage,
  recordDailyUsage,
  resolveDailyLimit,
} from "@/lib/api-quota";
import {
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_ROOM_NOT_FOUND,
  API_ERROR_INTERNAL_SERVER,
} from "@/lib/api-errors";
import { ApiError } from "@/lib/api-error-handler";

// ─── Quota Check ─────────────────────────────────────────────────────────────

export interface LabelQuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
}

/**
 * Checks daily label quota for a user. Throws ApiError if quota exceeded.
 */
export async function checkLabelQuota(userId: string): Promise<LabelQuotaResult> {
  const labelLimit = resolveDailyLimit(
    process.env[DAILY_LIMIT_ENV_VAR.label],
    DEFAULT_DAILY_LABEL_LIMIT
  );
  const labelQuota = evaluateDailyQuota(
    await getDailyUsage("label", userId),
    labelLimit
  );
  if (!labelQuota.allowed) {
    throw new ApiError({
      code: API_ERROR_RATE_LIMIT_EXCEEDED,
      message: dailyQuotaExceededPayload(labelQuota, "Please try again tomorrow.").message,
      status: 429,
    });
  }
  return { allowed: true, used: labelQuota.used, limit: labelQuota.limit };
}

// ─── Room Validation ─────────────────────────────────────────────────────────

/**
 * Validates that a room exists and belongs to the user.
 */
export async function validateLabelRoom(
  roomId: string,
  userId: string
): Promise<{ roomId: string }> {
  const room = await prisma.room.findFirst({
    where: { id: roomId, project: { userId } },
    select: { id: true },
  });
  if (!room) {
    throw new ApiError({
      code: API_ERROR_ROOM_NOT_FOUND,
      message: "The requested room could not be found.",
      status: 404,
    });
  }
  return { roomId: room.id };
}

// ─── Vision Label Generation ────────────────────────────────────────────────────

export interface VisionLabelEntry {
  instanceIndex: number;
  label: string;
}

export interface LabelGenerationResult {
  labels: VisionLabelEntry[];
}

/**
 * Generates vision labels for cropped instances using GPT-4o-mini.
 * Falls back to cached labels if available.
 */
export async function generateVisionLabels(
  params: {
    imageUrl: string;
    concept: string;
    crops: Array<{ instanceIndex: number; cropDataUrl: string }>;
    userId: string;
    roomId: string;
  }
): Promise<LabelGenerationResult> {
  const { imageUrl, concept, crops, userId, roomId } = params;

  const instanceIndices = crops.map((c) => c.instanceIndex);

  // Check cache first
  const cached = await getCachedVisionLabels({ imageUrl, concept, instanceIndices, userId });
  if (cached.length > 0) {
    const labels = cached.map((row) => ({
      instanceIndex: row.instanceIndex,
      label: row.label,
    }));
    return { labels };
  }

  // Generate new labels
  assertOpenAIConfigured();

  const cropsWithBytes = crops.map((crop) => ({
    instanceIndex: crop.instanceIndex,
    base64: crop.cropDataUrl.slice(crop.cropDataUrl.indexOf(",") + 1),
  }));

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
                    .map((crop) => crop.instanceIndex)
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

  const requested = new Set(crops.map((crop) => crop.instanceIndex));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labels: VisionLabelEntry[] = (object as any).labels.filter((entry: VisionLabelEntry) =>
    requested.has(entry.instanceIndex)
  );

  // Record usage and cache results
  await recordDailyUsage("label", userId);

  if (labels.length > 0) {
    await upsertVisionLabels({
      imageUrl,
      concept,
      results: labels,
      userId,
      roomId,
    });
  }

  return { labels };
}

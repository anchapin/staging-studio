import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { aiModel, assertOpenAIConfigured, generateWithCircuitBreaker } from "@/lib/ai";
import { visionLabelRequestSchema, visionLabelOutputSchema } from "@/lib/ai-route-schemas";
import { generateObject } from "ai";
import { z } from "zod";
import { getCachedVisionLabels, upsertVisionLabels } from "@/lib/vision-labels";

export interface LabelInstancesResult {
  labels: Array<{
    concept: string;
    instanceIndex: number;
    score: number;
    label: string;
  }>;
}

export interface LabelInstancesParams {
  userId: string;
  roomId: string;
  request: NextRequest;
}

export async function labelRoomInstances(
  params: LabelInstancesParams
): Promise<LabelInstancesResult> {
  const { userId, roomId, request } = params;

  const body = await request.json();
  const parsed = visionLabelRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new LabelInstancesValidationError(parsed.error);
  }

  const { imageUrl, concept, crops } = parsed.data;

  const room = await prisma.room.findFirst({
    where: { id: roomId, project: { userId } },
    select: { id: true },
  });
  if (!room) {
    throw new LabelInstancesNotFoundError();
  }

  const instanceIndices = crops.map((c) => c.instanceIndex);

  const cached = await getCachedVisionLabels({
    imageUrl,
    concept,
    instanceIndices,
    userId,
  });
  if (cached && cached.length === instanceIndices.length) {
    return {
      labels: cached.map((l) => ({
        concept,
        instanceIndex: l.instanceIndex,
        score: l.score ?? 0.9,
        label: l.label ?? concept,
      })),
    };
  }

  assertOpenAIConfigured();

  const labels = await generateVisionLabels(imageUrl, concept, crops);

  await upsertVisionLabels({
    imageUrl,
    concept,
    results: labels.map((l) => ({
      instanceIndex: l.instanceIndex,
      label: l.label,
      score: 0.9,
    })),
    userId,
    roomId,
  });

  return {
    labels: labels.map((l) => ({
      concept,
      instanceIndex: l.instanceIndex,
      score: 0.9,
      label: l.label,
    })),
  };
}

async function generateVisionLabels(
  imageUrl: string,
  concept: string,
  crops: Array<{ instanceIndex: number; cropDataUrl: string }>
): Promise<Array<{ instanceIndex: number; label: string }>> {
  const cropDescriptions = crops
    .map(
      (c, i) =>
        `  Crop ${i} (instance ${c.instanceIndex}): [${c.cropDataUrl.slice(0, 50)}...]`
    )
    .join("\n");

  const prompt = `You are analyzing a room photograph for home staging. A ${concept} was detected in the following image regions:\n${cropDescriptions}\n\nFor each detected region, provide a short noun-phrase label (max 60 chars) that describes what you see — e.g. "gray linen sofa", "oak dining table", "brass floor lamp". Be specific about color, material, and style. Return a JSON object with a "labels" array containing { instanceIndex, label } for each crop.`;

  let object: z.infer<typeof visionLabelOutputSchema>;
  try {
    const result = await generateWithCircuitBreaker(() =>
      generateObject({
        model: aiModel,
        schema: visionLabelOutputSchema,
        messages: [
          {
            role: "user",
            content: [
              prompt,
              "",
              `Image URL: ${imageUrl}`,
            ].join("\n"),
          },
        ],
      })
    );
    object = result.object;
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "label_instances_ai_error",
        imageUrl,
        concept,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    throw new LabelInstancesServiceError("Failed to generate labels. Please try again.");
  }

  return object.labels;
}

export class LabelInstancesValidationError extends Error {
  cause: unknown;
  constructor(error: unknown) {
    super("Validation failed");
    this.name = "LabelInstancesValidationError";
    this.cause = error;
  }
}

export class LabelInstancesNotFoundError extends Error {
  constructor() {
    super("Room not found");
    this.name = "LabelInstancesNotFoundError";
  }
}

export class LabelInstancesServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelInstancesServiceError";
  }
}

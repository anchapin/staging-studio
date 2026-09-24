import { NextResponse } from "next/server";
import { assertOpenAIConfigured, generateWithRetry } from "@/lib/ai";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  DEFAULT_DAILY_LABEL_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  getDailyUsage,
  recordDailyUsage,
  resolveDailyLimit,
} from "@/lib/api-quota";
import { visionLabelRequestSchema } from "@/lib/ai-route-schemas";
import { prisma } from "@/lib/prisma";
import { getCachedVisionLabels, upsertVisionLabels } from "@/lib/vision-labels";

export async function POST(req: Request) {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Not authenticated" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Bad Request", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = visionLabelRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", message: parsed.error.message },
      { status: 400 }
    );
  }

  const { roomId, concept, crops, imageUrl } = parsed.data;
  const instanceIndices = crops.map((c) => c.instanceIndex);

  const room = await prisma.room.findFirst({
    where: { id: roomId, project: { userId: user.id } },
    select: { id: true },
  });
  if (!room) {
    return NextResponse.json(
      { error: "Not Found", message: "Room not found" },
      { status: 404 }
    );
  }

  const cached = await getCachedVisionLabels({
    imageUrl,
    concept,
    instanceIndices,
    userId: user.id,
  });
  if (cached.length > 0) {
    const labels = cached.map((r) => ({ instanceIndex: r.instanceIndex, label: r.label }));
    return NextResponse.json({ labels, cached: true });
  }

  const limit = resolveDailyLimit(
    process.env[DAILY_LIMIT_ENV_VAR["label"]],
    DEFAULT_DAILY_LABEL_LIMIT
  );
  const usage = await getDailyUsage("label", user.id);
  if (usage >= limit) {
    return NextResponse.json(
      {
        error: "Daily limit reached",
        message: `You've reached today's limit of ${limit} label generations. Try again tomorrow.`,
        retryable: true,
        used: usage,
        limit,
      },
      { status: 429 }
    );
  }

  assertOpenAIConfigured();

  try {
    const { object } = await generateWithRetry({
      model: "gpt-4o-mini",
      output: "array",
      schema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            instanceIndex: { type: "number" },
            label: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["instanceIndex", "label"],
          additionalProperties: false,
        },
        maxItems: crops.length,
      },
      system: `You are an expert at identifying furniture and décor items in interior design images. Given the concept "${concept}", label the specified instances in the image with the most specific, accurate furniture term. Return an array with the instance index and the label.`,
      prompt: [
        `Concept: ${concept}`,
        `Instances: ${JSON.stringify(crops.map((c) => ({ instanceIndex: c.instanceIndex, crop: c.cropDataUrl })))}`,
        `Return a JSON array with {instanceIndex, label, confidence}.`,
      ].join("\n"),
      maxTokens: 512,
      temperature: 0.1,
    });

    const results = (object as { instanceIndex: number; label: string; confidence?: number }[])
      .filter((item) => item.label.trim().length > 0)
      .map((item) => ({
        instanceIndex: item.instanceIndex,
        label: item.label.trim(),
        score: item.confidence,
      }));

    await upsertVisionLabels({
      imageUrl,
      concept,
      results,
      userId: user.id,
      roomId,
    });

    await recordDailyUsage("label", user.id);

    return NextResponse.json({ labels: results, cached: false });
  } catch (err) {
    console.error("[/label-instances]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal Server Error", message },
      { status: 500 }
    );
  }
}

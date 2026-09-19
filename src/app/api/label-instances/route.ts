import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { aiModel, assertOpenAIConfigured } from "@/lib/ai";
import {
  visionLabelRequestSchema,
  visionLabelOutputSchema,
} from "@/lib/ai-route-schemas";

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
 * route. The generic daily copy quota intentionally does not apply:
 * detection itself is already quota-gated upstream (fal, #201), which
 * bounds how often labeling can fire.
 *
 * Contract: 401 unauthenticated; 404 when the room is not owned by the
 * caller; 400 on a schema-invalid body; 500 with a classified message on
 * provider failure. Success returns
 * `{ success: true, labels: [{ instanceIndex, label }] }` — labels for
 * instances the model could not name are simply absent (the client keeps
 * the concept fallback for those slots).
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

    const { roomId, concept, crops } = parsed.data;

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

    // Crop data URLs → raw base64 (the AI SDK's `file` part takes decoded
    // bytes; the deprecated `image` part is avoided).
    const cropsWithBytes = crops.map((crop) => ({
      instanceIndex: crop.instanceIndex,
      base64: crop.cropDataUrl.slice(crop.cropDataUrl.indexOf(",") + 1),
    }));

    const { object } = await generateObject({
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
    });

    // Keep only labels for instance indices the caller actually sent — the
    // model occasionally echoes stray indices, and the client keys labels
    // by detection-response index.
    const requested = new Set(crops.map((crop) => crop.instanceIndex));
    const labels = object.labels.filter((entry) => requested.has(entry.instanceIndex));

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

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fal } from "@/lib/fal";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { inpaintRequestSchema } from "@/lib/ai-route-schemas";

const NEGATIVE_PROMPT =
  "walls, windows, trim, doors, molding, structural columns, flooring";

const inpaintSubmitSchema = inpaintRequestSchema.extend({
  roomId: z.string().min(1),
  variantSlot: z
    .number()
    .int()
    .refine((value) => value === 0 || value === 1),
});

type FalQueueSubmitFunction = (
  id: string,
  options: { input: Record<string, unknown> }
) => Promise<{ request_id: string }>;

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "You must be signed in to start inpainting.",
        },
        { status: 401 }
      );
    }

    const parsed = inpaintSubmitSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message:
            "Please provide a valid imageUrl, maskUrl, promptDirectives, aesthetic, roomId, and variantSlot.",
          issues: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const { imageUrl, maskUrl, promptDirectives, aesthetic, roomId, variantSlot } =
      parsed.data;

    const room = await prisma.room.findFirst({
      where: { id: roomId, project: { userId: user.id } },
      select: { id: true },
    });
    if (!room) {
      return NextResponse.json(
        {
          error: "Room not found",
          message: "The requested room could not be found.",
        },
        { status: 404 }
      );
    }

    const prompt = `${aesthetic} style. ${promptDirectives}`;

    // Fire-and-forget submit: returns as soon as the job is queued (~2s),
    // instead of holding the request open for the full generation.
    const falQueueSubmit = fal.queue.submit as FalQueueSubmitFunction;
    const submission = await falQueueSubmit("fal-ai/flux-fill", {
      input: {
        image_url: imageUrl,
        mask_url: maskUrl,
        prompt,
        negative_prompt: NEGATIVE_PROMPT,
        guidance: 7.5,
        num_inference_steps: 28,
      },
    });

    // Persist the requestId → room mapping before responding so the status
    // route can attribute requests and a refresh can resume polling.
    await prisma.inpaintRequest.create({
      data: {
        id: submission.request_id,
        roomId: room.id,
        variantSlot,
        status: "IN_QUEUE",
      },
    });

    return NextResponse.json({ requestId: submission.request_id });
  } catch (error) {
    console.error("Inpaint API error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Failed to start inpainting request";

    if (errorMessage.includes("credentials") || errorMessage.includes("auth")) {
      return NextResponse.json(
        {
          error: "Authentication failed",
          message: "Unable to connect to the image editing service. Please check your configuration.",
        },
        { status: 401 }
      );
    }

    if (errorMessage.includes("timeout") || errorMessage.includes("TIMEOUT")) {
      return NextResponse.json(
        {
          error: "Request timeout",
          message: "The image editing service is taking too long to respond. Please try again.",
        },
        { status: 408 }
      );
    }

    return NextResponse.json(
      {
        error: "Inpainting failed",
        message: "We couldn't process your image. Please try again.",
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { fal } from "@/lib/fal";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { inpaintRequestSchema } from "@/lib/ai-route-schemas";

const NEGATIVE_PROMPT =
  "walls, windows, trim, doors, molding, structural columns, flooring";

type FalSubscribeFunction = (
  id: string,
  options: Record<string, unknown>
) => Promise<{ requestId: string }>;

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

    const parsed = inpaintRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message:
            "Please provide a valid imageUrl, maskUrl, promptDirectives, and aesthetic.",
          issues: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const { imageUrl, maskUrl, promptDirectives, aesthetic } = parsed.data;

    const prompt = `${aesthetic} style. ${promptDirectives}`;

    const falSubscribe = fal.subscribe as FalSubscribeFunction;
    const result = await falSubscribe("fal-ai/flux-fill", {
      input: {
        image_url: imageUrl,
        mask_url: maskUrl,
        prompt,
        negative_prompt: NEGATIVE_PROMPT,
        guidance: 7.5,
        num_inference_steps: 28,
      },
      pollInterval: 1000,
    });

    return NextResponse.json({ requestId: result.requestId });
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

import { NextRequest, NextResponse } from "next/server";
import { fal } from "@/lib/fal";

const NEGATIVE_PROMPT =
  "walls, windows, trim, doors, molding, structural columns, flooring";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageUrl, maskUrl, promptDirectives, aesthetic } = body;

    if (!imageUrl || !maskUrl || !promptDirectives || !aesthetic) {
      return NextResponse.json(
        { error: "Missing required fields: imageUrl, maskUrl, promptDirectives, aesthetic" },
        { status: 400 }
      );
    }

    const prompt = `${aesthetic} style. ${promptDirectives}`;

    const result = await fal.subscribe("fal-ai/flux-fill", {
      input: {
        image_url: imageUrl,
        mask_url: maskUrl,
        prompt,
        negative_prompt: NEGATIVE_PROMPT,
        guidance: 7.5,
        num_inference_steps: 28,
      },
      pollInterval: 1000,
      maxRetries: 60,
    });

    return NextResponse.json({ requestId: result.requestId });
  } catch (error) {
    console.error("Inpaint API error:", error);
    return NextResponse.json(
      { error: "Failed to start inpainting request" },
      { status: 500 }
    );
  }
}

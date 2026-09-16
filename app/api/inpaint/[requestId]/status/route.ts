import { NextRequest, NextResponse } from "next/server";
import { fal } from "@/lib/fal";
import { createClient } from "@/lib/supabase";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params;

    if (!requestId) {
      return NextResponse.json(
        { error: "Missing requestId" },
        { status: 400 }
      );
    }

    const result = await fal.subscribe("fal-ai/flux-fill", {
      requestId,
      pollInterval: 1000,
      maxRetries: 60,
    });

    if (result.status === "ERROR") {
      return NextResponse.json(
        { error: "Inpainting failed", details: result.error },
        { status: 500 }
      );
    }

    if (result.status === "COMPLETED") {
      const imageUrl = result.images?.[0]?.url;

      if (imageUrl) {
        const supabase = createClient();
        await supabase.storage
          .from("staging-images")
          .upload(`after-${requestId}.png`, await fetch(imageUrl).then((r) => r.blob()), {
            contentType: "image/png",
            upsert: true,
          });

        const { data: publicUrlData } = supabase.storage
          .from("staging-images")
          .getPublicUrl(`after-${requestId}.png`);

        return NextResponse.json({
          status: "completed",
          imageUrl: publicUrlData.publicUrl,
        });
      }

      return NextResponse.json(
        { error: "No image in result" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: result.status,
    });
  } catch (error) {
    console.error("Inpaint status API error:", error);
    return NextResponse.json(
      { error: "Failed to check inpainting status" },
      { status: 500 }
    );
  }
}

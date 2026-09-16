import { NextRequest, NextResponse } from "next/server";
import { fal } from "@/lib/fal";
import { createClient } from "@/lib/supabase";
import { getAuthedPrismaUser } from "@/lib/api-auth";

interface FalStatusResult {
  status: string;
  images?: Array<{ url: string }>;
  error?: string;
}

type FalQueueStatusFunction = (
  id: string,
  options: { requestId: string }
) => Promise<FalStatusResult>;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "You must be signed in to check inpainting status.",
        },
        { status: 401 }
      );
    }

    const { requestId } = await params;

    if (!requestId) {
      return NextResponse.json(
        {
          error: "Missing requestId",
          message: "Request ID is required to check status",
        },
        { status: 400 }
      );
    }

    const falQueueStatus = fal.queue.status as FalQueueStatusFunction;
    const result = await falQueueStatus("fal-ai/flux-fill", { requestId });

    if (result.status === "ERROR") {
      return NextResponse.json(
        {
          error: "Inpainting failed",
          message: "The image editing process encountered an error. Please try again.",
          retryable: true,
        },
        { status: 500 }
      );
    }

    if (result.status === "COMPLETED") {
      const imageUrl = result.images?.[0]?.url;

      if (imageUrl) {
        const supabase = createClient();

        try {
          await supabase.storage
            .from("staging-images")
            .upload(
              `after-${requestId}.png`,
              await fetch(imageUrl).then((r) => r.blob()),
              {
                contentType: "image/png",
                upsert: true,
              }
            );

          const { data: publicUrlData } = supabase.storage
            .from("staging-images")
            .getPublicUrl(`after-${requestId}.png`);

          return NextResponse.json({
            status: "completed",
            imageUrl: publicUrlData.publicUrl,
          });
        } catch (storageError) {
          console.error("Storage error:", storageError);
          return NextResponse.json({
            status: "completed",
            imageUrl: imageUrl,
          });
        }
      }

      return NextResponse.json(
        {
          error: "Processing incomplete",
          message: "The image was processed but could not be retrieved. Please try again.",
          retryable: true,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: result.status,
    });
  } catch (error) {
    console.error("Inpaint status API error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Failed to check inpainting status";

    if (errorMessage.includes("not found") || errorMessage.includes("NOT_FOUND")) {
      return NextResponse.json(
        {
          error: "Request not found",
          message: "This image processing request could not be found. It may have expired.",
          retryable: true,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        error: "Status check failed",
        message: "Unable to check image processing status. Please try again.",
        retryable: true,
      },
      { status: 500 }
    );
  }
}

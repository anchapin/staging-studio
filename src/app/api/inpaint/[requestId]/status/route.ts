import { NextRequest, NextResponse } from "next/server";
import { fal } from "@/lib/fal";
import { prisma } from "@/lib/prisma";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { decideInpaintPersistence } from "@/lib/inpaint-persistence";

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

    // Ownership: the requestId must map to a persisted InpaintRequest whose
    // room's project belongs to the caller — otherwise 404 (do not leak or
    // proxy other users' requests).
    const inpaintRequest = await prisma.inpaintRequest.findUnique({
      where: { id: requestId },
      select: {
        status: true,
        resultUrl: true,
        room: { select: { project: { select: { userId: true } } } },
      },
    });
    if (!inpaintRequest || inpaintRequest.room.project.userId !== user.id) {
      return NextResponse.json(
        {
          error: "Request not found",
          message:
            "This image processing request could not be found or you don't have access to it.",
        },
        { status: 404 }
      );
    }

    // Once-only durability: an already-COMPLETED row with a stored resultUrl
    // has a durable Supabase copy — serve it without touching fal, without
    // re-downloading the image, and without re-uploading.
    const persistenceDecision = decideInpaintPersistence({
      status: inpaintRequest.status,
      resultUrl: inpaintRequest.resultUrl,
    });

    if (persistenceDecision.kind === "return-stored") {
      return NextResponse.json({
        status: "completed",
        imageUrl: persistenceDecision.url,
        persisted: true,
      });
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
      const falImageUrl = result.images?.[0]?.url;

      if (!falImageUrl) {
        return NextResponse.json(
          {
            error: "Processing incomplete",
            message: "The image was processed but could not be retrieved. Please try again.",
            retryable: true,
          },
          { status: 500 }
        );
      }

      // First completed poll for this request: download the fal result once
      // and persist it to Supabase storage. supabase-js v2 resolves uploads
      // with `{ data, error }` instead of throwing, so the result must be
      // checked explicitly — a failed upload must never be reported as a
      // successfully written object.
      let persisted = true;
      let resolvedImageUrl = falImageUrl;

      try {
        const imageBlob = await fetch(falImageUrl).then((r) => r.blob());
        const supabase = await createSupabaseRequestClient();
        const objectPath = `after-${requestId}.png`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("staging-images")
          .upload(objectPath, imageBlob, {
            contentType: "image/png",
            upsert: true,
          });

        if (uploadError || !uploadData) {
          persisted = false;
          console.error(
            `[inpaint:${requestId}] Supabase storage upload failed:`,
            uploadError?.message ?? "upload resolved without data"
          );
        } else {
          // getPublicUrl is deterministic and returns a URL even for objects
          // that were never written — only trust it after a confirmed upload.
          const { data: publicUrlData } = supabase.storage
            .from("staging-images")
            .getPublicUrl(objectPath);

          if (publicUrlData?.publicUrl) {
            resolvedImageUrl = publicUrlData.publicUrl;
          } else {
            persisted = false;
            console.error(
              `[inpaint:${requestId}] Supabase getPublicUrl returned no public URL.`
            );
          }
        }
      } catch (storageError) {
        persisted = false;
        console.error(
          `[inpaint:${requestId}] Failed to persist inpaint result to storage:`,
          storageError
        );
      }

      if (persisted) {
        try {
          await prisma.inpaintRequest.update({
            where: { id: requestId },
            data: { status: "COMPLETED", resultUrl: resolvedImageUrl },
          });
        } catch (recordError) {
          console.error(
            `[inpaint:${requestId}] Failed to record inpaint completion:`,
            recordError
          );
        }

        return NextResponse.json({
          status: "completed",
          imageUrl: resolvedImageUrl,
          persisted: true,
        });
      }

      // Storage persistence failed: return the fal URL explicitly marked as
      // not persisted so the client can warn — it expires, so it must not be
      // treated as a durable success.
      return NextResponse.json({
        status: "completed",
        imageUrl: falImageUrl,
        persisted: false,
      });
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

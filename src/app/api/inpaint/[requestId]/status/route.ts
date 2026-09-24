import { NextRequest, NextResponse } from "next/server";
import { fal } from "@/lib/fal";
import { prisma } from "@/lib/prisma";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { decideInpaintPersistence } from "@/lib/inpaint-persistence";
import { classifyIntegrationError } from "@/lib/error-classify";
import { FAL_FLUX_FILL_MODEL } from "@/lib/prompts";
import { checkRateLimit } from "@/lib/sliding-window-ratelimit";

const STATUS_POLL_RATE_LIMIT = 30;
const STATUS_POLL_WINDOW_MS = 60_000;

const INPAINT_STATUS_ERROR_COPY = {
  notFound: {
    error: "Request not found",
    message: "This image processing request could not be found. It may have expired.",
  },
  unknown: {
    error: "Status check failed",
    message: "Unable to check image processing status. Please try again.",
  },
};

// Terminal payload for a permanently failed inpaint job (fal ERROR).
// `retryable: false` + `status: "ERROR"` are both read as terminal by the
// client's polling classifier (src/lib/inpaint-polling.ts).
const INPAINT_TERMINAL_ERROR_BODY = {
  status: "ERROR",
  error: "Inpainting failed",
  message: "The image editing process encountered an error. Please try again.",
  retryable: false,
};

interface FalStatusResult {
  status: string;
  images?: Array<{ url: string }>;
  error?: string;
}

type FalQueueStatusFunction = (
  id: string,
  options: { requestId: string }
) => Promise<FalStatusResult>;

type FalQueueResultFunction = (
  id: string,
  options: { requestId: string }
) => Promise<{ images?: Array<{ url: string }> } | null>;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  // Hoisted so the catch block can correlate failures with the inpaint job
  // even when the error fires before the route params are read.
  let requestId: string | undefined;
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

    const rateLimit = checkRateLimit(user.id, STATUS_POLL_RATE_LIMIT, STATUS_POLL_WINDOW_MS);
    if (!rateLimit.allowed) {
      const retryAfter = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        {
          error: "Too many requests",
          message: "Please slow down",
          retryAfter,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
            "X-RateLimit-Limit": String(STATUS_POLL_RATE_LIMIT),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000)),
          },
        }
      );
    }

    const { requestId: requestIdParam } = await params;
    requestId = requestIdParam;

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

    // Terminal durability (issue #686): an ERROR row is a permanently dead
    // job — serve the terminal payload immediately without calling fal.
    // This also covers resumed polls after a refresh, so they fail fast
    // instead of burning the full poll budget against a dead requestId.
    if (inpaintRequest.status === "ERROR") {
      return NextResponse.json(INPAINT_TERMINAL_ERROR_BODY, { status: 500 });
    }

    const falQueueStatus = fal.queue.status as FalQueueStatusFunction;
    const falQueueResult = fal.queue.result as FalQueueResultFunction;

    // PERSISTENCE_FAILED: persistence previously failed (Supabase storage error).
    // Retry by fetching the fal result and attempting persistence again.
    // On success: DB updated to COMPLETED with storage URL.
    // On failure: stays PERSISTENCE_FAILED; client polls again.
    if (inpaintRequest.status === "PERSISTENCE_FAILED") {
      let persisted = true;
      let resolvedImageUrl: string | null = null;
      try {
        const falResult = await falQueueResult(FAL_FLUX_FILL_MODEL, { requestId }).catch(
          () => null
        );
        const falImageUrl: string | null = falResult?.images?.[0]?.url ?? null;
        if (!falImageUrl) throw new Error("fal result unavailable");

        const imageBlob = await fetch(falImageUrl).then((r) => r.blob());
        const supabase = await createSupabaseRequestClient();
        const objectPath = `after-${requestId}.png`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("staging-images")
          .upload(objectPath, imageBlob, {
            contentType: "image/png",
            upsert: true,
          });

        if (uploadError || !uploadData) throw new Error(uploadError?.message ?? "upload failed");
        const storageUrl = supabase.storage
          .from("staging-images")
          .getPublicUrl(objectPath).data.publicUrl;
        resolvedImageUrl = storageUrl;
      } catch {
        persisted = false;
      }

      if (persisted && resolvedImageUrl) {
        await prisma.inpaintRequest.update({
          where: { id: requestId },
          data: { status: "COMPLETED", resultUrl: resolvedImageUrl },
        });
        return NextResponse.json({
          status: "completed",
          imageUrl: resolvedImageUrl,
          persisted: true,
        });
      }

      return NextResponse.json({
        status: "retryable",
        imageUrl: null,
        persisted: false,
      });
    }

    const statusResponse = await falQueueStatus(FAL_FLUX_FILL_MODEL, { requestId });

    if (statusResponse.status === "ERROR") {
      // Persist the terminal state so subsequent and resumed polls
      // short-circuit above. Best-effort: a failed write must not flip the
      // terminal response back into a retryable one.
      try {
        await prisma.inpaintRequest.update({
          where: { id: requestId },
          data: { status: "ERROR" },
        });
      } catch (recordError) {
        console.error(
          JSON.stringify({
            event: "inpaint_error_record_failed",
            requestId,
          }),
          recordError
        );
      }

      return NextResponse.json(INPAINT_TERMINAL_ERROR_BODY, { status: 500 });
    }

    if (statusResponse.status === "COMPLETED") {
      // The queue status payload does not include the generated image —
      // fetch it from the result endpoint (fal serves it right after the
      // status flips to COMPLETED). A failure here must not crash the
      // route, but it must be logged (issue #717) so a fal result-endpoint
      // outage is correlatable in production instead of surfacing only as
      // unexplained retryable 500s.
      const falResult = await falQueueResult(FAL_FLUX_FILL_MODEL, {
        requestId,
      }).catch((resultError: unknown) => {
        console.error(
          JSON.stringify({
            event: "inpaint_result_fetch_failed",
            requestId,
          }),
          resultError
        );
        return null;
      });
      const falImageUrl = falResult?.images?.[0]?.url;

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
            JSON.stringify({
              event: "inpaint_upload_failed",
              requestId,
            }),
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
              JSON.stringify({
                event: "inpaint_public_url_missing",
                requestId,
              })
            );
          }
        }
      } catch (storageError) {
        persisted = false;
        console.error(
          JSON.stringify({
            event: "inpaint_persist_failed",
            requestId,
          }),
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
            JSON.stringify({
              event: "inpaint_record_failed",
              requestId,
            }),
            recordError
          );
        }

        return NextResponse.json({
          status: "completed",
          imageUrl: resolvedImageUrl,
          persisted: true,
        });
      }

      // Storage persistence failed: update DB to PERSISTENCE_FAILED so subsequent
      // polls retry persistence, and return retryable so the client knows to poll again.
      await prisma.inpaintRequest.update({
        where: { id: requestId },
        data: { status: "PERSISTENCE_FAILED", resultUrl: null },
      });
      return NextResponse.json({
        status: "retryable",
        imageUrl: falImageUrl,
        persisted: false,
      });
    }

    return NextResponse.json({
      status: statusResponse.status,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "inpaint_status_failed",
        requestId: requestId ?? null,
      }),
      error
    );

    const classified = classifyIntegrationError(error, INPAINT_STATUS_ERROR_COPY);

    return NextResponse.json(
      {
        error: classified.error,
        message: classified.message,
        retryable: classified.retryable,
      },
      { status: classified.status }
    );
  }
}

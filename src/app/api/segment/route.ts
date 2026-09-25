import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { buildDeprecationHeaders } from "@/lib/api-version";
import { segmentRequestSchema } from "@/lib/ai-route-schemas";
import { checkSegmentQuota, validateSegmentRoom, runSegmentation } from "@/lib/segment-service";
import { buildSegmentServerTimingEvent, emitSegmentTiming } from "@/lib/segment-timing";
import { API_ERROR_UNAUTHORIZED, API_ERROR_INVALID_REQUEST } from "@/lib/api-errors";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { createPreflightResponse, withCors } from "@/lib/cors";
import { withNextRouteLogging } from "@/lib/api-logging";
import { trackError } from "@/lib/error-tracking";

export const POST = withErrorHandler(async (request: NextRequest) => {
  return withNextRouteLogging(request, null, async () => {
    const startedAt = Date.now();

    // Hoisted so the catch block can correlate failures with the room even
    // when the error fires before/after the request body is parsed.
    let roomId: string | undefined;
    try {
      const user = await getAuthedPrismaUser();
      if (!user) {
        return NextResponse.json(
          {
            error: "Unauthorized",
            message: "You must be signed in to select objects.",
            code: API_ERROR_UNAUTHORIZED,
          },
          { status: 401, headers: buildDeprecationHeaders() }
        );
      }

      const parsed = segmentRequestSchema.safeParse(await request.json());
      if (!parsed.success) {
        throw new ApiError({
          code: API_ERROR_INVALID_REQUEST,
          message: "Please provide a valid roomId, imageUrl, click point, and image dimensions.",
          status: 400,
          details: parsed.error.issues,
        });
      }

      const { imageUrl, point, warm } = parsed.data;
      roomId = parsed.data.roomId;

      await checkSegmentQuota(user.id);
      await validateSegmentRoom(roomId, user.id);

      if (warm) {
        emitSegmentTiming(
          buildSegmentServerTimingEvent({
            totalMs: Date.now() - startedAt,
            falMs: null,
            warm: true,
            roomId: roomId ?? null,
          })
        );
        return withCors(NextResponse.json({ warmed: true }));
      }

      const { maskDataUrl, falMs } = await runSegmentation({
        imageUrl,
        point,
        roomId,
        userId: user.id,
      });

      emitSegmentTiming(
        buildSegmentServerTimingEvent({
          totalMs: Date.now() - startedAt,
          falMs,
          warm: false,
          roomId: roomId ?? null,
        })
      );

      return withCors(NextResponse.json({ maskDataUrl }));
    } catch (err) {
      trackError(err, { action: "POST /api/segment", roomId });
      throw err;
    }
  });
});

export const OPTIONS = createPreflightResponse;

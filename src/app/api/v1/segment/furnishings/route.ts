/**
 * v1 Segment Furnishings Route
 *
 * Rate-limited and ownership-checked stub for GPT-4o-mini concept detection
 * on SAM 3.1 segmentation masks (furnishings detection).
 * Demonstrates the versioned API pattern with full security controls.
 *
 * POST /api/v1/segment/furnishings
 *
 * Version header: API-Version: v1
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { buildVersionHeaders } from "@/lib/api-version";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_DAILY_SEGMENT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  evaluateDailyQuota,
  getDailyUsage,
  resolveDailyLimit,
} from "@/lib/api-quota";

const SegmentFurnishingsRequestBodySchema = z.object({
  roomId: z.string().min(1),
  imageUrl: z.string().url(),
  concept: z.string().optional(),
});

export const dynamic = "force-dynamic";

/** POST /api/v1/segment/furnishings – submit a furnishings detection request. */
export async function POST(request: NextRequest) {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", message: "You must be signed in to detect furnishings." },
      { status: 401 }
    );
  }

  // Rate limit check
  const segmentLimit = resolveDailyLimit(
    process.env[DAILY_LIMIT_ENV_VAR.segment],
    DEFAULT_DAILY_SEGMENT_LIMIT
  );
  const segmentUsage = await getDailyUsage("segment", user.id);
  const segmentQuota = evaluateDailyQuota(segmentUsage, segmentLimit);
  if (!segmentQuota.allowed) {
    console.warn(
      JSON.stringify({
        event: "v1_segment_furnishings_daily_quota_exceeded",
        userId: user.id,
        used: segmentQuota.used,
        limit: segmentQuota.limit,
      })
    );
    return NextResponse.json(dailyQuotaExceededPayload(segmentQuota, "Submitting furnishings detection requests"), {
      status: 429,
    });
  }

  // Parse and validate request body
  const body = await request.json().catch(() => null);
  const parsed = SegmentFurnishingsRequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", message: "Request body is invalid." },
      { status: 400 }
    );
  }

  // Ownership check: verify user owns the room's project
  const room = await prisma.room.findFirst({
    where: { id: parsed.data.roomId, project: { userId: user.id } },
    select: { id: true },
  });
  if (!room) {
    return NextResponse.json(
      { error: "Forbidden", message: "Room not found or access denied." },
      { status: 403 }
    );
  }

  return NextResponse.json(
    {
      message: "v1 segment furnishings endpoint stub",
      note: "Submit furnishings detection via the non-v1 /api/segment/furnishings endpoint.",
      version: "v1",
    },
    { headers: buildVersionHeaders("v1") }
  );
}

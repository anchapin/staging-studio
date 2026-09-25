/**
 * v1 Segment Route
 *
 * Rate-limited and ownership-checked stub for SAM 3.1 image segmentation.
 * Demonstrates the versioned API pattern with full security controls.
 *
 * POST /api/v1/segment
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

const SegmentRequestBodySchema = z.object({
  roomId: z.string().min(1),
  imageUrl: z.string().url(),
  clickPoint: z.object({
    x: z.number(),
    y: z.number(),
  }),
  imageWidth: z.number().positive(),
  imageHeight: z.number().positive(),
  warm: z.boolean().optional(),
});

export const dynamic = "force-dynamic";

/** POST /api/v1/segment – submit a segmentation request. */
export async function POST(request: NextRequest) {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", message: "You must be signed in to segment images." },
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
        event: "v1_segment_daily_quota_exceeded",
        userId: user.id,
        used: segmentQuota.used,
        limit: segmentQuota.limit,
      })
    );
    return NextResponse.json(dailyQuotaExceededPayload(segmentQuota, "Submitting segmentation requests"), {
      status: 429,
    });
  }

  // Parse and validate request body
  const body = await request.json().catch(() => null);
  const parsed = SegmentRequestBodySchema.safeParse(body);
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
      message: "v1 segment endpoint stub",
      note: "Submit segmentation requests via the non-v1 /api/segment endpoint.",
      version: "v1",
    },
    { headers: buildVersionHeaders("v1") }
  );
}

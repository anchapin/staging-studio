/**
 * v1 Inpaint Route
 *
 * Rate-limited and ownership-checked stub for the fal.ai FLUX.1 Fill
 * inpainting endpoint. Demonstrates the versioned API pattern with full
 * security controls.
 *
 * POST /api/v1/inpaint
 *
 * Version header: X-Supabase-API-Version: v1
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { buildVersionHeaders } from "@/lib/api-version";
import { prisma } from "@/lib/prisma";
import { inpaintSubmitSchema } from "@/lib/inpaint-submit";
import {
  API_ERROR_INVALID_REQUEST,
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_ROOM_NOT_FOUND,
  API_ERROR_UNAUTHORIZED,
} from "@/lib/api-errors";
import {
  DEFAULT_DAILY_INPAINT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  evaluateDailyQuota,
  getDailyUsage,
  resolveDailyLimit,
} from "@/lib/api-quota";

export const dynamic = "force-dynamic";

/** POST /api/v1/inpaint – submit an inpaint request. */
export async function POST(request: NextRequest) {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", code: API_ERROR_UNAUTHORIZED, message: "You must be signed in to submit inpaint requests." },
      { status: 401 }
    );
  }

  // Rate limit: today's charged inpaint units from the DailyApiUsage
  // counter row (#985 counted InpaintRequest rows, which a room delete
  // refunded — #1131).
  const inpaintLimit = resolveDailyLimit(
    process.env[DAILY_LIMIT_ENV_VAR.inpaint],
    DEFAULT_DAILY_INPAINT_LIMIT
  );
  const inpaintCount = await getDailyUsage("inpaint", user.id);
  const inpaintQuota = evaluateDailyQuota(inpaintCount, inpaintLimit);
  if (!inpaintQuota.allowed) {
    console.warn(
      JSON.stringify({
        event: "v1_inpaint_daily_quota_exceeded",
        userId: user.id,
        used: inpaintQuota.used,
        limit: inpaintQuota.limit,
      })
    );
    return NextResponse.json(
      { ...dailyQuotaExceededPayload(inpaintQuota, "Submitting inpaint requests"), code: API_ERROR_RATE_LIMIT_EXCEEDED },
      { status: 429 }
    );
  }

  // Parse and validate request body
  const body = await request.json().catch(() => null);
  const parsed = inpaintSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", code: API_ERROR_INVALID_REQUEST, message: "Request body is invalid." },
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
      { error: "Forbidden", code: API_ERROR_ROOM_NOT_FOUND, message: "Room not found or access denied." },
      { status: 403 }
    );
  }

  // IMPLEMENTATION NOTE (issue #1125): this stub does no work, so the quota
  // check above only READS today's counter and nothing is charged. When this
  // stub is implemented, claimDailyQuota(...) (issue #1132) must run before
  // the provider call, or this route becomes a silent cap bypass.
  return NextResponse.json(
    {
      message: "v1 inpaint endpoint stub",
      note: "Submit inpaint requests via the non-v1 /api/inpaint endpoint.",
      version: "v1",
    },
    { headers: buildVersionHeaders("v1") }
  );
}

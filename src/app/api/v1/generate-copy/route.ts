/**
 * v1 Generate Copy Route
 *
 * Rate-limited and ownership-checked stub for GPT-4o-mini copywriting.
 * Demonstrates the versioned API pattern with full security controls.
 *
 * POST /api/v1/generate-copy
 *
 * Version header: X-Supabase-API-Version: v1
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { buildVersionHeaders } from "@/lib/api-version";
import { prisma } from "@/lib/prisma";
import { generateCopyRequestSchema } from "@/lib/ai-route-schemas";
import {
  API_ERROR_INVALID_REQUEST,
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_ROOM_NOT_FOUND,
  API_ERROR_UNAUTHORIZED,
} from "@/lib/api-errors";
import {
  DEFAULT_DAILY_COPY_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  evaluateDailyQuota,
  getDailyUsage,
  resolveDailyLimit,
} from "@/lib/api-quota";

export const dynamic = "force-dynamic";

/** POST /api/v1/generate-copy – submit a copy generation request. */
export async function POST(request: NextRequest) {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", code: API_ERROR_UNAUTHORIZED, message: "You must be signed in to generate copy." },
      { status: 401 }
    );
  }

  // Rate limit check
  const copyLimit = resolveDailyLimit(
    process.env[DAILY_LIMIT_ENV_VAR.copy],
    DEFAULT_DAILY_COPY_LIMIT
  );
  const copyUsage = await getDailyUsage("copy", user.id);
  const copyQuota = evaluateDailyQuota(copyUsage, copyLimit);
  if (!copyQuota.allowed) {
    console.warn(
      JSON.stringify({
        event: "v1_generate_copy_daily_quota_exceeded",
        userId: user.id,
        used: copyQuota.used,
        limit: copyQuota.limit,
      })
    );
    return NextResponse.json(
      { ...dailyQuotaExceededPayload(copyQuota, "Generating copy"), code: API_ERROR_RATE_LIMIT_EXCEEDED },
      { status: 429 }
    );
  }

  // Parse and validate request body
  const body = await request.json().catch(() => null);
  const parsed = generateCopyRequestSchema.safeParse(body);
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
      message: "v1 generate-copy endpoint stub",
      note: "Generate copy via the non-v1 /api/generate-copy endpoint.",
      version: "v1",
    },
    { headers: buildVersionHeaders("v1") }
  );
}

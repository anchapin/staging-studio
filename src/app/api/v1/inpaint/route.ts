/**
 * v1 Inpaint Route
 *
 * Rate-limited and ownership-checked stub for the fal.ai FLUX.1 Fill
 * inpainting endpoint. Demonstrates the versioned API pattern with full
 * security controls.
 *
 * POST /api/v1/inpaint
 *
 * Version header: API-Version: v1
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { buildVersionHeaders } from "@/lib/api-version";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_DAILY_INPAINT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  evaluateDailyQuota,
  inpaintDailyUsageWhere,
  resolveDailyLimit,
} from "@/lib/api-quota";

const InpaintRequestBodySchema = z.object({
  roomId: z.string().min(1),
  imageUrl: z.string().url(),
  maskImageUrl: z.string().url(),
  prompt: z.string().min(1).max(1000),
  seed: z.number().int().optional(),
});

export const dynamic = "force-dynamic";

/** POST /api/v1/inpaint – submit an inpaint request. */
export async function POST(request: NextRequest) {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", message: "You must be signed in to submit inpaint requests." },
      { status: 401 }
    );
  }

  // Rate limit: count InpaintRequest rows via exact Postgres query (#985)
  const inpaintLimit = resolveDailyLimit(
    process.env[DAILY_LIMIT_ENV_VAR.inpaint],
    DEFAULT_DAILY_INPAINT_LIMIT
  );
  const inpaintCount = await prisma.inpaintRequest.count({
    where: inpaintDailyUsageWhere(user.id),
  });
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
    return NextResponse.json(dailyQuotaExceededPayload(inpaintQuota, "Submitting inpaint requests"), {
      status: 429,
    });
  }

  // Parse and validate request body
  const body = await request.json().catch(() => null);
  const parsed = InpaintRequestBodySchema.safeParse(body);
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
      message: "v1 inpaint endpoint stub",
      note: "Submit inpaint requests via the non-v1 /api/inpaint endpoint.",
      version: "v1",
    },
    { headers: buildVersionHeaders("v1") }
  );
}

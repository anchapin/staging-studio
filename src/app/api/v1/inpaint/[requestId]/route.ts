/**
 * v1 Inpaint Status Route
 *
 * Rate-limited and ownership-checked stub for checking inpaint request status.
 * Demonstrates the versioned API pattern with full security controls.
 *
 * GET /api/v1/inpaint/[requestId]
 *
 * Version header: API-Version: v1
 */
import { NextRequest, NextResponse } from "next/server";
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

export const dynamic = "force-dynamic";

/** GET /api/v1/inpaint/[requestId] – get inpaint request status. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", message: "You must be signed in to check inpaint status." },
      { status: 401 }
    );
  }

  const { requestId } = await params;

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
    return NextResponse.json(dailyQuotaExceededPayload(inpaintQuota, "Checking inpaint status"), {
      status: 429,
    });
  }

  // Ownership check: verify user owns the inpaint request via room→project
  const inpaintRequest = await prisma.inpaintRequest.findFirst({
    where: { id: requestId, room: { project: { userId: user.id } } },
    select: { id: true },
  });
  if (!inpaintRequest) {
    return NextResponse.json(
      { error: "Forbidden", message: "Inpaint request not found or access denied." },
      { status: 403 }
    );
  }

  return NextResponse.json(
    {
      message: "v1 inpaint status endpoint stub",
      note: "Check inpaint status via the non-v1 /api/inpaint/[requestId] endpoint.",
      version: "v1",
    },
    { headers: buildVersionHeaders("v1") }
  );
}

import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  DEFAULT_DAILY_SEGMENT_LIMIT,
  resolveDailyLimit,
  evaluateDailyQuota,
  getDailyUsage,
} from "@/lib/api-quota";
import {
  detectFurnishings,
  SegmentValidationError,
  SegmentNotFoundError,
} from "@/lib/api-segment-furnishings";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = resolveDailyLimit("segment", DEFAULT_DAILY_SEGMENT_LIMIT);
  const decision = evaluateDailyQuota(await getDailyUsage("segment", user.id), limit);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Daily segment limit reached", remaining: 0, limit, resetsAt: decision.resetsAt },
      { status: 429 }
    );
  }

  const roomId = request.headers.get("X-Room-ID") ?? "";
  try {
    const result = await detectFurnishings({ userId: user.id, roomId, request });
    return NextResponse.json(
      { ...result, remaining: decision.remaining, limit },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof SegmentValidationError) {
      return NextResponse.json({ error: err.message, details: err.cause }, { status: 400 });
    }
    if (err instanceof SegmentNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error(
      JSON.stringify({
        event: "segment_furnishings_error",
        roomId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  DEFAULT_DAILY_LABEL_LIMIT,
  resolveDailyLimit,
  evaluateDailyQuota,
  getDailyUsage,
} from "@/lib/api-quota";
import {
  labelRoomInstances,
  LabelInstancesValidationError,
  LabelInstancesNotFoundError,
} from "@/lib/api-label-instances";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = resolveDailyLimit("label", DEFAULT_DAILY_LABEL_LIMIT);
  const decision = evaluateDailyQuota(await getDailyUsage("label", user.id), limit);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Daily label limit reached", remaining: 0, limit, resetsAt: decision.resetsAt },
      { status: 429 }
    );
  }

  const roomId = request.headers.get("X-Room-ID") ?? "";
  try {
    const result = await labelRoomInstances({ userId: user.id, roomId, request });
    return NextResponse.json(
      { ...result, remaining: decision.remaining, limit },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof LabelInstancesValidationError) {
      return NextResponse.json({ error: err.message, details: err.cause }, { status: 400 });
    }
    if (err instanceof LabelInstancesNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error(
      JSON.stringify({
        event: "label_instances_error",
        roomId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

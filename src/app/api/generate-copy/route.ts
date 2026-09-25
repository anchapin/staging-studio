import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  DEFAULT_DAILY_COPY_LIMIT,
  resolveDailyLimit,
  evaluateDailyQuota,
  getDailyUsage,
} from "@/lib/api-quota";
import {
  generateCopyForRoom,
  GenerateCopyValidationError,
  GenerateCopyNotFoundError,
  GenerateCopyMissingDirectivesError,
  GenerateCopySaveError,
} from "@/lib/api-generate-copy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = resolveDailyLimit("copy", DEFAULT_DAILY_COPY_LIMIT);
  const decision = evaluateDailyQuota(await getDailyUsage("copy", user.id), limit);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Daily copy limit reached", remaining: 0, limit, resetsAt: decision.resetsAt },
      { status: 429 }
    );
  }

  const roomId = request.headers.get("X-Room-ID") ?? "";
  try {
    const result = await generateCopyForRoom({ userId: user.id, roomId, request });
    return NextResponse.json(
      { ...result, remaining: decision.remaining, limit },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof GenerateCopyValidationError) {
      return NextResponse.json({ error: err.message, details: err.cause.format() }, { status: 400 });
    }
    if (err instanceof GenerateCopyNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof GenerateCopyMissingDirectivesError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof GenerateCopySaveError) {
      return NextResponse.json({ error: err.message, retryable: err.retryable }, { status: 500 });
    }
    console.error(
      JSON.stringify({
        event: "generate_copy_error",
        roomId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

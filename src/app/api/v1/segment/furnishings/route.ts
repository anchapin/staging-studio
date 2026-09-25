/**
 * v1 Segment Furnishings Route
 *
 * Demonstrates the versioned API pattern for the segment furnishings AI endpoint.
 *
 * POST /api/v1/segment/furnishings
 *
 * Version header: API-Version: v1
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { buildVersionHeaders } from "@/lib/api-version";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", message: "You must be signed in to detect furnishings." },
      { status: 401, headers: buildVersionHeaders("v1") }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json(
      { error: "Invalid request", message: "Request body is required." },
      { status: 400, headers: buildVersionHeaders("v1") }
    );
  }

  return NextResponse.json(
    {
      message: "This is the v1 segment/furnishings endpoint.",
      note: "The v1 routes demonstrate the versioning pattern.",
      version: "v1",
    },
    { status: 200, headers: buildVersionHeaders("v1") }
  );
}

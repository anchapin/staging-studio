/**
 * v1 Generate Copy Route
 *
 * Demonstrates the versioned API pattern for the generate-copy AI endpoint.
 * This route handles GPT-4o-mini copywriting requests with versioned responses.
 *
 * POST /api/v1/generate-copy
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
      { error: "Unauthorized", message: "You must be signed in to generate copy." },
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
      message: "This is the v1 generate-copy endpoint. See /api/v1/generate-copy for the full implementation.",
      note: "The v1 routes demonstrate the versioning pattern. Production v1 implementations should use the handler extraction pattern documented in docs/API_VERSIONING.md.",
      version: "v1",
    },
    { status: 200, headers: buildVersionHeaders("v1") }
  );
}

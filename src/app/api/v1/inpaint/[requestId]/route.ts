/**
 * v1 Inpaint Status Route
 *
 * Demonstrates the versioned API pattern for the inpaint status endpoint.
 *
 * GET /api/v1/inpaint/[requestId]
 *
 * Version header: API-Version: v1
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { buildVersionHeaders } from "@/lib/api-version";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", message: "You must be signed in to check inpainting status." },
      { status: 401, headers: buildVersionHeaders("v1") }
    );
  }

  const { requestId } = await params;
  void requestId; // requestId would be used in production to look up the inpaint request

  return NextResponse.json(
    {
      message: "This is the v1 inpaint/[requestId] endpoint.",
      note: "The v1 routes demonstrate the versioning pattern.",
      version: "v1",
    },
    { status: 200, headers: buildVersionHeaders("v1") }
  );
}

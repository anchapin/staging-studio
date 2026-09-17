import { NextRequest, NextResponse } from "next/server";
import { verifyPreviewToken, signPreviewToken } from "@/lib/preview-token";

export async function GET(request: NextRequest) {
  const localToken = request.nextUrl.searchParams.get("localToken") || "";
  const self = await signPreviewToken("self-test", 60);
  const selfOk = (await verifyPreviewToken(self)).valid;
  const local = await verifyPreviewToken(localToken);
  return NextResponse.json({
    hasSecret: Boolean(process.env.PREVIEW_TOKEN_SECRET),
    secretLen: (process.env.PREVIEW_TOKEN_SECRET || "").length,
    selfSignVerify: selfOk,
    localTokenVerdict: local.valid ? { valid: true, projectId: local.projectId } : { valid: false },
  });
}

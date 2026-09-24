import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { verifyPreviewToken, signPreviewToken } from "@/lib/preview-token";
import { withErrorHandler } from "@/lib/api-error-handler";

const _get = async (request: NextRequest): Promise<Response> => {
  // Issue #702: diagnostic-only self-test — must not exist in production,
  // and self-guards like every other /api/* route outside production.
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message: "You must be signed in to run the preview-token self-test.",
      },
      { status: 401 }
    );
  }

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
};

export const GET = withErrorHandler(_get);

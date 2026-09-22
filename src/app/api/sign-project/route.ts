import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { verifyPreviewToken } from "@/lib/preview-token";

// cuid() pattern for projectId validation
const PROJECT_ID_PATTERN = /^c[a-z0-9]{24}$/;

const SIGN_ERROR_COPY = {
  invalidToken: {
    error: "Invalid token",
    message: "The preview link has expired or is invalid. Please request a new one from the staging firm.",
  },
  invalidProject: {
    error: "Invalid project",
    message: "The project could not be found.",
  },
  saveFailed: {
    error: "Save failed",
    message: "Unable to save the signature. Please try again.",
  },
};

/**
 * POST /api/sign-project
 *
 * Saves the client's digital sign-off signature to a project record.
 * Access is validated via the preview token (same HMAC token used for PDF export).
 * This allows clients to sign the lookbook without creating an account.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, signatureDataUrl, token } = body;

    // Validate projectId format
    if (typeof projectId !== "string" || !PROJECT_ID_PATTERN.test(projectId)) {
      return NextResponse.json(SIGN_ERROR_COPY.invalidProject, { status: 400 });
    }

    // Validate signature data URL
    if (typeof signatureDataUrl !== "string" || !signatureDataUrl.startsWith("data:image/png;base64,")) {
      return NextResponse.json(
        { error: "Invalid signature", message: "Signature must be a PNG data URL." },
        { status: 400 }
      );
    }

    // Validate preview token
    if (typeof token !== "string" || !token) {
      return NextResponse.json(SIGN_ERROR_COPY.invalidToken, { status: 401 });
    }

    const tokenVerification = await verifyPreviewToken(token);
    if (
      !tokenVerification.valid ||
      tokenVerification.projectId !== projectId
    ) {
      return NextResponse.json(SIGN_ERROR_COPY.invalidToken, { status: 401 });
    }

    // Save signature to project
    try {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          clientSignature: signatureDataUrl,
          clientSignatureStatus: "Signed",
          clientSignatureTimestamp: new Date(),
        },
      });
    } catch {
      return NextResponse.json(SIGN_ERROR_COPY.saveFailed, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Server error", message: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import type { ZodError } from "zod";

import { prisma } from "@/lib/prisma";
import { verifyPreviewToken } from "@/lib/preview-token";
import { withRetry } from "@/lib/retry";
import {
  signProjectRequestSchema,
  tokenMatchesProject,
} from "@/lib/sign-project-schema";

const SIGN_ERROR_COPY = {
  invalidToken: {
    error: "Invalid token",
    message: "The preview link has expired or is invalid. Please request a new one from the staging firm.",
  },
  invalidProject: {
    error: "Invalid project",
    message: "The project could not be found.",
  },
  invalidSignature: {
    error: "Invalid signature",
    message: "Signature must be a PNG data URL of at most 1 MB.",
  },
  alreadySigned: {
    error: "Already signed",
    message:
      "This project has already been signed. The staging firm must reset the signature before it can be signed again.",
  },
  saveFailed: {
    error: "Save failed",
    message: "Unable to save the signature. Please try again.",
  },
} as const;

/** Maps the first schema issue to the matching HTTP error response. */
function validationFailure(error: ZodError): NextResponse {
  const field = error.issues[0]?.path[0];
  if (field === "projectId") {
    return NextResponse.json(SIGN_ERROR_COPY.invalidProject, { status: 400 });
  }
  if (field === "signatureDataUrl") {
    return NextResponse.json(SIGN_ERROR_COPY.invalidSignature, { status: 400 });
  }
  return NextResponse.json(SIGN_ERROR_COPY.invalidToken, { status: 401 });
}

/**
 * POST /api/sign-project
 *
 * Saves the client's digital sign-off signature to a project record.
 * Access is validated via the preview token (same HMAC token used for
 * PDF export). This allows clients to sign the lookbook without
 * creating an account.
 *
 * Thin wrapper (issue #684): the payload is validated by
 * `signProjectRequestSchema` (projectId cuid pattern, PNG data-URL
 * prefix, ~1 MB cap), the token's validity + projectId scope are
 * asserted via `tokenMatchesProject` BEFORE any Prisma access, and a
 * project already recorded as "Signed" is immutable — re-signing
 * requires an explicit firm-side reset. Prisma failures are logged
 * with a structured `sign_project_save_failed` event, never swallowed.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const parsed = signProjectRequestSchema.safeParse(body);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }
    const { projectId, signatureDataUrl, token } = parsed.data;

    const tokenVerification = await verifyPreviewToken(token);
    if (!tokenMatchesProject(tokenVerification, projectId)) {
      return NextResponse.json(SIGN_ERROR_COPY.invalidToken, { status: 401 });
    }

    const existing = await prisma.project.findUnique({
      where: { id: projectId },
      select: { clientSignatureStatus: true },
    });
    if (!existing) {
      return NextResponse.json(SIGN_ERROR_COPY.invalidProject, { status: 404 });
    }
    if (existing.clientSignatureStatus === "Signed") {
      return NextResponse.json(SIGN_ERROR_COPY.alreadySigned, { status: 409 });
    }

    try {
      await withRetry(
        async () =>
          prisma.project.update({
            where: { id: projectId },
            data: {
              clientSignature: signatureDataUrl,
              clientSignatureStatus: "Signed",
              clientSignatureTimestamp: new Date(),
            },
          }),
        3,
        200
      );
    } catch (error) {
      console.error("sign_project_save_failed", {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
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

import { NextRequest, NextResponse } from "next/server";
import type { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { createPreflightResponse, withCors } from "@/lib/cors";
import {
  getAuthedPrismaUser,
  requireProjectOwnershipOrThrow,
  ProjectNotFoundError,
  ProjectForbiddenError,
} from "@/lib/api-auth";
import { verifyPreviewToken } from "@/lib/preview-token";
import { withRetry } from "@/lib/retry";
import {
  signProjectRequestSchema,
  tokenMatchesProject,
} from "@/lib/sign-project-schema";
import {
  API_ERROR_INVALID_TOKEN,
  API_ERROR_INVALID_PROJECT,
  API_ERROR_INVALID_SIGNATURE,
  API_ERROR_ALREADY_SIGNED,
  API_ERROR_SAVE_FAILED,
  API_ERROR_INTERNAL_SERVER,
} from "@/lib/api-errors";

const SIGN_ERROR_COPY = {
  invalidToken: {
    error: "Invalid token",
    message: "The preview link has expired or is invalid. Please request a new one from the staging firm.",
    code: API_ERROR_INVALID_TOKEN,
  },
  invalidProject: {
    error: "Invalid project",
    message: "The project could not be found.",
    code: API_ERROR_INVALID_PROJECT,
  },
  invalidSignature: {
    error: "Invalid signature",
    message: "Signature must be a PNG data URL of at most 1 MB.",
    code: API_ERROR_INVALID_SIGNATURE,
  },
  alreadySigned: {
    error: "Already signed",
    message:
      "This project has already been signed. The staging firm must reset the signature before it can be signed again.",
    code: API_ERROR_ALREADY_SIGNED,
  },
  saveFailed: {
    error: "Save failed",
    message: "Unable to save the signature. Please try again.",
    code: API_ERROR_SAVE_FAILED,
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
 * Gate order (issue #1078): the payload and HMAC preview token are
 * validated FIRST, before any session lookup. A valid token scoped to
 * `projectId` is the credential — cookie-less preview visitors (the
 * whole point of the token surface from issue #684) must reach the
 * Prisma write without being 401'd by `getAuthedPrismaUser`. The
 * session check still runs as defense-in-depth when no valid token is
 * presented (a missing/forged token falls through to the session gate,
 * preserving the prior 401 behavior for unauthenticated requests
 * without a token).
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
      return withCors(validationFailure(parsed.error));
    }
    const { projectId, signatureDataUrl, token } = parsed.data;

    // Token-first gate (issue #1078): the HMAC preview token is the
    // route's intended credential. Verify it before consulting the
    // session so cookie-less preview visitors aren't 401'd out of the
    // mutation that the preview page renders.
    const tokenVerification = await verifyPreviewToken(token);
    const tokenUnlocked = tokenMatchesProject(tokenVerification, projectId);
    if (!tokenUnlocked) {
      return withCors(NextResponse.json(SIGN_ERROR_COPY.invalidToken, { status: 401 }));
    }

    // Defense-in-depth for session-bearing callers: an authenticated
    // firm user with a (now-validated) token still goes through the
    // ownership check, preserving the pre-#1078 behavior. Cookie-less
    // preview visitors reach the write via `tokenUnlocked` alone —
    // the token IS their credential.
    const user = await getAuthedPrismaUser();
    if (user) {
      try {
        await requireProjectOwnershipOrThrow(projectId, user);
      } catch (e) {
        if (e instanceof ProjectNotFoundError) {
          return withCors(NextResponse.json(SIGN_ERROR_COPY.invalidProject, { status: 404 }));
        }
        if (e instanceof ProjectForbiddenError) {
          return withCors(NextResponse.json(
            { error: "Forbidden", message: "You do not have permission to sign this project." },
            { status: 403 }
          ));
        }
        throw e;
      }
    }
    // Capture timestamp once before the retry loop so retries don't shift
    // the recorded time (issue #1146).
    const signatureTimestamp = new Date();

    try {
      const { count } = await withRetry(
        async () =>
          prisma.project.updateMany({
            where: {
              id: projectId,
              clientSignatureStatus: { not: "Signed" },
            },
            data: {
              clientSignature: signatureDataUrl,
              clientSignatureStatus: "Signed",
              clientSignatureTimestamp: signatureTimestamp,
            },
          }),
        3,
        200
      );

      // updateMany returns count === 0 when no rows matched the where clause,
      // which means the project was already signed by another request.
      if (count === 0) {
        return withCors(NextResponse.json(SIGN_ERROR_COPY.alreadySigned, { status: 409 }));
      }
    } catch (error) {
      console.error("sign_project_save_failed", {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return withCors(NextResponse.json(SIGN_ERROR_COPY.saveFailed, { status: 500 }));
    }

    return withCors(NextResponse.json({ success: true }));
  } catch {
    return withCors(NextResponse.json(
      { error: "Server error", message: "An unexpected error occurred.", code: API_ERROR_INTERNAL_SERVER },
      { status: 500 }
    ));
  }
}

export const OPTIONS = createPreflightResponse;

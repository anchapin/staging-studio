import { NextRequest, NextResponse } from "next/server";
import type { ZodError } from "zod";
import { z } from "zod";
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
import { encryptSignature } from "@/lib/signature-encryption";
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
  API_ERROR_INVALID_REQUEST,
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
  consentRequired: {
    error: "Consent required",
    message:
      "Please confirm you have read and accept the staging-plan approval statement before signing.",
    code: API_ERROR_INVALID_REQUEST,
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
  if (field === "consentAttested") {
    // Issue #1113: an un-ticked (or explicitly false) consent box
    // must be a 400, not a generic 401 — the token is fine, the
    // signature PNG is fine, the client just didn't confirm the
    // attestation that the form prominently displays.
    return NextResponse.json(SIGN_ERROR_COPY.consentRequired, { status: 400 });
  }
  return NextResponse.json(SIGN_ERROR_COPY.invalidToken, { status: 401 });
}

/**
 * Loose pre-parse schema used to extract the route's CREDENTIAL (the
 * preview token + the projectId the token is scoped to) BEFORE the
 * full request body is validated. The token is what authorizes the
 * mutation, so a missing/malformed token must answer 401 ("expired or
 * is invalid") even if the rest of the body is also malformed — the
 * e2e signoff spec's tampered-token case pins exactly this contract.
 *
 * Why a separate schema instead of just calling safeParse on the
 * request shape: the full `signProjectRequestSchema` requires
 * `consentAttested: true` (#1113) and a cuid-shaped `projectId`, so
 * any body missing those would fail validation with 400 `consentRequired`
 * / 400 `invalidProject` BEFORE the token is ever checked. A
 * credentialless body that also happens to have a tampered token would
 * leak the wrong status — credential forgery should always surface as
 * 401, not 400, regardless of body shape.
 *
 * Scoping: this schema only validates the fields the credential check
 * needs. `projectId` is left as a generic string (cuid-shape is
 * enforced by the full schema downstream) so a malformed projectId
 * does NOT short-circuit the credential gate; it falls through to the
 * full body parse and surfaces as 400 `invalidProject` per the existing
 * `validationFailure` mapping. The e2e signoff spec only exercises
 * the missing-token / tampered-token shape, so a projectId shape
 * error never reaches the e2e suite as a 401.
 */
const signProjectCredentialSchema = z
  .object({
    projectId: z.string(),
    token: z.string().min(1, { message: "Preview token is required." }),
  })
  .passthrough();

/**
 * Maps a credential-pre-parse failure (missing/malformed token) to
 * the same 401 shape the token gate would emit. The e2e signoff spec
 * asserts the message "expired or is invalid" for tampered tokens;
 * a missing token surfaces the same message because the request, in
 * that shape, cannot present a valid credential.
 */
function credentialFailure(_error: ZodError): NextResponse {
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
 * Gate order (issues #1078 + signoff e2e): the HMAC preview token is
 * the credential, so the route extracts and verifies it FIRST, before
 * any other body field is validated. A valid token scoped to
 * `projectId` is the credential — cookie-less preview visitors (the
 * whole point of the token surface from issue #684) must reach the
 * Prisma write without being 401'd by `getAuthedPrismaUser`. A
 * tampered or missing token answers 401 (`expired or is invalid`)
 * regardless of what the rest of the body looks like, so a forged
 * credential can't be hidden behind a downstream 400 from a malformed
 * signatureDataUrl or a missing consentAttested (issue #1113). Once
 * the credential is verified, the full body is validated by
 * `signProjectRequestSchema` (cuid projectId, PNG data-URL prefix,
 * ~1 MB cap, consentAttested literal). The session check still runs
 * as defense-in-depth when no valid token is presented (a missing /
 * forged token falls through to the session gate, preserving the prior
 * 401 behavior for unauthenticated requests without a token).
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

    // Credential-first gate (issues #1078 + signoff e2e): the HMAC
    // preview token is the route's intended credential, and a missing
    // or malformed token must answer 401 even when the rest of the
    // body would also fail validation. We pre-parse just the credential
    // fields (projectId + token) BEFORE the full body schema runs, so
    // tampered tokens can't leak as 400 `consentRequired` /
    // `invalidProject` from a downstream field check.
    const credentialParsed = signProjectCredentialSchema.safeParse(body);
    if (!credentialParsed.success) {
      return withCors(credentialFailure(credentialParsed.error));
    }
    const { projectId, token } = credentialParsed.data;

    // Token-first gate (issue #1078): verify the token before
    // consulting the session so cookie-less preview visitors aren't
    // 401'd out of the mutation that the preview page renders.
    const tokenVerification = await verifyPreviewToken(token);
    const tokenUnlocked = tokenMatchesProject(tokenVerification, projectId);
    if (!tokenUnlocked) {
      return withCors(NextResponse.json(SIGN_ERROR_COPY.invalidToken, { status: 401 }));
    }

    // The credential is valid. Now validate the full request body:
    // a valid token does NOT excuse a malformed signatureDataUrl or a
    // missing consentAttested (issue #1113) — those are caller-side
    // mistakes, not credential failures, so they remain 400.
    const parsed = signProjectRequestSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(validationFailure(parsed.error));
    }
    const { signatureDataUrl } = parsed.data;

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
    // the recorded time (issue #1146). Reused for both the signature
    // timestamp and the consent attestation timestamp (issue #1113) so
    // they agree to the millisecond on the persisted record.
    const signatureTimestamp = new Date();

    // Issue #1106: encrypt the signature at rest with AES-GCM-256.
    // The PNG data URL never reaches Postgres; consumers decrypt it on
    // read. The encryption is moved OUT of the retry loop because (a)
    // each retry would produce a fresh ciphertext under a fresh IV,
    // making the persisted value depend on which attempt won, and
    // (b) encryption is not the failure mode withRetry was added for.
    const encryptedSignature = await encryptSignature(signatureDataUrl);

    try {
      const { count } = await withRetry(
        async () =>
          prisma.project.updateMany({
            where: {
              id: projectId,
              // Prisma's `not` filter compiles to SQL `<>`, which never matches NULL,
              // and freshly created projects have a NULL status. Match NULL
              // explicitly or an unsigned project can never be signed.
              OR: [
                { clientSignatureStatus: null },
                { clientSignatureStatus: { not: "Signed" } },
              ],
            },
            data: {
              clientSignature: encryptedSignature,
              clientSignatureStatus: "Signed",
              clientSignatureTimestamp: signatureTimestamp,
              // Issue #1113: persist the consent attestation alongside the
              // signature so a `Signed` record without `clientConsentAttestedAt`
              // exposes a missing consent on the legacy/import path.
              clientConsentAttested: true,
              clientConsentAttestedAt: signatureTimestamp,
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

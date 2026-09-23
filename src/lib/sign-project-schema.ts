import { z } from "zod";

/**
 * Zod schemas and pure helpers for the client sign-project flow
 * (issue #684), shared by the session-less `POST /api/sign-project`
 * route (preview-token access) and the firm-side `saveProjectSignature`
 * server action, so both write paths enforce identical validation.
 *
 * Side effects: none — pure validation.
 */

/**
 * cuid-style projectId pattern (Prisma's default id generator):
 * a literal `c` followed by exactly 24 lowercase alphanumerics.
 */
export const PROJECT_ID_PATTERN = /^c[a-z0-9]{24}$/;

/** Required prefix of the signature image: a base64-encoded PNG data URL. */
export const SIGNATURE_DATA_URL_PREFIX = "data:image/png;base64,";

/**
 * Maximum accepted length of the signature PNG data-URL string:
 * 1,048,576 characters (1 MB of text). Base64 expands binary 4:3, so
 * this caps the decoded PNG at ~770 KB — generous for a signature-
 * canvas export (typically tens of KB) while preventing multi-MB
 * payloads from bloating `Project.clientSignature`, the lookbook
 * page render, and the PDF-export preview fetch.
 */
export const MAX_SIGNATURE_DATA_URL_LENGTH = 1_048_576;

const projectIdSchema = z.string().regex(PROJECT_ID_PATTERN, {
  message: "Invalid project id format.",
});

const signatureDataUrlSchema = z
  .string()
  .startsWith(SIGNATURE_DATA_URL_PREFIX, {
    message: "Signature must be a PNG data URL.",
  })
  .max(MAX_SIGNATURE_DATA_URL_LENGTH, {
    message: `Signature must be at most ${MAX_SIGNATURE_DATA_URL_LENGTH} characters.`,
  });

/**
 * Zod schema for the shared sign-project payload: the fields written by
 * BOTH the API route and the `saveProjectSignature` server action.
 * `.strict()` rejects unknown keys, so only these client-controlled
 * values can ever be validated through this path.
 */
export const signProjectPayloadSchema = z
  .object({
    projectId: projectIdSchema,
    signatureDataUrl: signatureDataUrlSchema,
  })
  .strict();

/** The validated shape of a {@link signProjectPayloadSchema} parse. */
export type SignProjectPayload = z.infer<typeof signProjectPayloadSchema>;

/**
 * Zod schema for the full `POST /api/sign-project` request body: the
 * shared payload plus the preview token (the route's only credential;
 * the session-authenticated server action does not take one).
 */
export const signProjectRequestSchema = signProjectPayloadSchema
  .extend({
    token: z.string().min(1, { message: "Preview token is required." }),
  })
  .strict();

/** The validated shape of a {@link signProjectRequestSchema} parse. */
export type SignProjectRequest = z.infer<typeof signProjectRequestSchema>;

/**
 * Pure token-scope check for the sign-project route: a token
 * verification unlocks the requested project only when the token is
 * valid AND was signed for exactly that projectId. Extracted from the
 * route (issue #684) so the wrong-project mismatch path is testable
 * without HTTP or crypto.
 */
export function tokenMatchesProject(
  verification: { valid: true; projectId: string } | { valid: false },
  projectId: string
): boolean {
  return verification.valid && verification.projectId === projectId;
}

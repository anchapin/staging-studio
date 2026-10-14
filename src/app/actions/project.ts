"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  projectMetadataSchema,
  type ProjectMetadataInput,
} from "@/lib/metadata-schemas";
import { signProjectPayloadSchema } from "@/lib/sign-project-schema";
import { virtuallyStagedLabelEnabledSchema } from "@/lib/metadata-schemas";
import { revalidatePath } from "next/cache";

/**
 * Server action: updates editable project metadata fields.
 *
 * Purpose: powers the project settings form on `/projects/[id]`.
 * Only the fields present in `metadata` are written; `undefined` values
 * are ignored by Prisma, never nulled out.
 *
 * Contract: requires an authenticated session; the update's `where`
 * filter (`id: projectId, userId: user.id`) enforces ownership, so a
 * foreign projectId matches nothing and returns "Not authenticated".
 * `metadata` is validated with `projectMetadataSchema` — server action
 * arguments are client-controlled RPC payloads, so only the six
 * editable fields can ever reach Prisma (`.strict()` rejects unknown
 * keys like `userId`, preventing ownership transfer). Failures are
 * caught and reported, never thrown.
 *
 * Side effects: needs `DATABASE_URL` and a valid Supabase session
 * cookie; performs a Prisma `project.update` and calls
 * `revalidatePath(/projects/{projectId})` so the page reflects the
 * change; logs failures to `console.error`.
 *
 * @param projectId ID of the project to update.
 * @param metadata Partial fields: `propertyAddress`, `clientName`,
 *   `targetBuyer`, `stagingAesthetic`, and/or `stagingDirectives`.
 * @returns `{ success: true }` on write, or
 *   `{ success: false, error }` when unauthenticated, the payload is
 *   invalid, or the update fails.
 */
export async function saveProjectMetadata(
  projectId: string,
  metadata: ProjectMetadataInput
): Promise<{ success: boolean; error?: string }> {
  const parsed = projectMetadataSchema.safeParse(metadata);
  if (!parsed.success) {
    return {
      success: false,
      error:
        parsed.error.issues[0]?.message ?? "Invalid project metadata payload",
    };
  }

  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    await prisma.project.update({
      where: { id: projectId, userId: user.id },
      data: parsed.data,
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/preview/${projectId}`);
    return { success: true };
  } catch (error) {
    console.error("Failed to save project metadata:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Server action: saves the client digital sign-off signature (issue #556).
 *
 * Purpose: records the client's drawn/typed signature and approval timestamp
 * on the project record. The signature PNG data URL is stored and the
 * status is set to "Signed".
 *
 * Contract: requires an authenticated session; ownership is enforced by the
 * Prisma `where` filter (`id: projectId, userId: user.id`). The payload is
 * validated with `signProjectPayloadSchema` (issue #684) — the same
 * validator the session-less `/api/sign-project` route uses — so a
 * malformed projectId, non-PNG data URL, oversized signature (over
 * ~1 MB), or un-attested consent (issue #1113) can never reach Prisma
 * from either write path.
 *
 * @param projectId ID of the project to sign off.
 * @param signatureDataUrl PNG data URL of the signature canvas.
 * @param consentAttested Must be `true` — confirms the legally-worded
 *   approval statement was shown and accepted. Recorded on the project
 *   row alongside the signature so the attestation is auditable.
 * @returns `{ success: true }` on write, or
 * `{ success: false, error }` when unauthenticated, the payload is
 * invalid, or the save fails.
 */
export async function saveProjectSignature(
  projectId: string,
  signatureDataUrl: string,
  consentAttested: boolean
): Promise<{ success: boolean; error?: string }> {
  const parsed = signProjectPayloadSchema.safeParse({
    projectId,
    signatureDataUrl,
    consentAttested,
  });
  if (!parsed.success) {
    return {
      success: false,
      error:
        parsed.error.issues[0]?.message ?? "Invalid signature payload",
    };
  }

  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  // Capture timestamp once so retries don't shift the recorded time
  // (same concern as issue #1146 for the route handler). Reused for
  // the consent attestation timestamp (issue #1113) so the two fields
  // agree on the persisted record.
  const signatureTimestamp = new Date();

  try {
    // Use updateMany with a conditional guard so a second signer cannot
    // overwrite an existing signature (issue #1146).
    const { count } = await prisma.project.updateMany({
      where: {
        id: parsed.data.projectId,
        userId: user.id,
        // Prisma's `not` filter compiles to SQL `<>`, which never matches NULL,
        // and freshly created projects have a NULL status. Match NULL
        // explicitly or an unsigned project can never be signed.
        OR: [
          { clientSignatureStatus: null },
          { clientSignatureStatus: { not: "Signed" } },
        ],
      },
      data: {
        clientSignature: parsed.data.signatureDataUrl,
        clientSignatureStatus: "Signed",
        clientSignatureTimestamp: signatureTimestamp,
        // Issue #1113: persist the consent attestation alongside the
        // signature. The schema (`literal(true)`) already guarantees we
        // only reach this write when the client ticked the box.
        clientConsentAttested: true,
        clientConsentAttestedAt: signatureTimestamp,
      },
    });

    if (count === 0) {
      return {
        success: false,
        error: "This project has already been signed. The staging firm must reset the signature before it can be signed again.",
      };
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/lookbook`);
    revalidatePath(`/preview/${projectId}`);
    return { success: true };
  } catch (error) {
    console.error("Failed to save project signature:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Server action: toggles the "Virtually staged" disclosure mark for a
 * project (issue #1186).
 *
 * Purpose: lets Lauren turn the disclosure mark on/off per project so
 * she can match her local MLS or the listing agent's requirements.
 * Defaults to ON — an unlabelled staged photo is the exact thing the
 * disclosure exists to prevent.
 *
 * Contract: requires an authenticated session; ownership is enforced by
 * the Prisma `where` filter (`id: projectId, userId: user.id`). The
 * payload is validated by {@link virtuallyStagedLabelEnabledSchema} — a
 * boolean only, strict, so a crafted payload carrying `userId` (or any
 * other persisted column) can never transfer ownership or write a
 * non-editable field.
 *
 * Side effects: needs `DATABASE_URL` and a valid Supabase session
 * cookie; performs a Prisma `project.update` and calls
 * `revalidatePath(/projects/{projectId})` and
 * `revalidatePath(/preview/{projectId})` so both the project dashboard
 * and the cookie-less preview reflect the change immediately. Logs
 * failures to `console.error`.
 *
 * @param projectId ID of the project to update.
 * @param enabled `true` to show the "Virtually staged" mark on AI
 *   after-images in the lookbook preview; `false` to hide it.
 * @returns `{ success: true }` on write, or
 *   `{ success: false, error }` when unauthenticated, the payload is
 *   invalid, or the update fails.
 */
export async function saveVirtuallyStagedLabelEnabled(
  projectId: string,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  const parsed = virtuallyStagedLabelEnabledSchema.safeParse({
    projectId,
    enabled,
  });
  if (!parsed.success) {
    return {
      success: false,
      error:
        parsed.error.issues[0]?.message ??
        "Invalid virtually-staged-label payload",
    };
  }

  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    await prisma.project.update({
      where: { id: parsed.data.projectId, userId: user.id },
      data: { virtuallyStagedLabelEnabled: parsed.data.enabled },
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/lookbook`);
    revalidatePath(`/preview/${projectId}`);
    return { success: true };
  } catch (error) {
    console.error("Failed to save virtually-staged-label setting:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

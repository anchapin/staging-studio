"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  projectMetadataSchema,
  type ProjectMetadataInput,
} from "@/lib/metadata-schemas";
import { signProjectPayloadSchema } from "@/lib/sign-project-schema";
import { encryptSignature } from "@/lib/signature-encryption";
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
 * malformed projectId, non-PNG data URL, or oversized signature (over
 * ~1 MB) can never reach Prisma from either write path.
 *
 * @param projectId ID of the project to sign off.
 * @param signatureDataUrl PNG data URL of the signature canvas.
 * @returns `{ success: true }` on write, or
 * `{ success: false, error }` when unauthenticated, the payload is
 * invalid, or the save fails.
 */
export async function saveProjectSignature(
  projectId: string,
  signatureDataUrl: string
): Promise<{ success: boolean; error?: string }> {
  const parsed = signProjectPayloadSchema.safeParse({ projectId, signatureDataUrl });
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

  try {
    await prisma.project.update({
      where: { id: parsed.data.projectId, userId: user.id },
      data: {
        clientSignature: await encryptSignature(parsed.data.signatureDataUrl),
        clientSignatureStatus: "Signed",
        clientSignatureTimestamp: new Date(),
      },
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/lookbook`);
    return { success: true };
  } catch (error) {
    console.error("Failed to save project signature:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

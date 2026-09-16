"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
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
 * Failures are caught and reported, never thrown.
 *
 * Side effects: needs `DATABASE_URL` and a valid Supabase session
 * cookie; performs a Prisma `project.update` and calls
 * `revalidatePath(/projects/{projectId})` so the page reflects the
 * change; logs failures to `console.error`.
 *
 * @param projectId ID of the project to update.
 * @param metadata Partial fields: `propertyAddress`, `clientName`,
 *   `targetBuyer`, and/or `stagingAesthetic`.
 * @returns `{ success: true }` on write, or
 *   `{ success: false, error }` when unauthenticated or the update fails.
 */
export async function saveProjectMetadata(
  projectId: string,
  metadata: {
    propertyAddress?: string;
    clientName?: string;
    targetBuyer?: string;
    stagingAesthetic?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    await prisma.project.update({
      where: { id: projectId, userId: user.id },
      data: metadata,
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

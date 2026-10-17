"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { revalidatePath } from "next/cache";
import {
  roomFinishSchema,
  type RoomFinishInput,
} from "@/lib/room-finish-schema";

function failure(error: string): { success: false; error: string } {
  return { success: false, error };
}

/**
 * Server action: records the user's "chosen finish" on a room (issue
 * #1182).
 *
 * The room-level finish is the persisted opt-in anchor for the
 * "reuse a chosen finish across every photo of the same room" flow:
 * once a user is happy with a finish on one photo, calling this
 * action stores the MaterialSwatch id (nullable), the staging
 * directives text, and the concept label so the same finish can later
 * be seeded into another photo's inpaint directives (the mask still
 * requires a fresh SAM pass per photo — this action does not touch
 * any image data).
 *
 * Contract:
 * - Requires an authenticated session; the ownership-filtered
 *   `room.findFirst` and `room.update` both scope to the caller's
 *   `userId`.
 * - If `materialFinishId` is set, the referenced MaterialSwatch must
 *   belong to the same project as the room (cross-project lookups
 *   are rejected — a finish is a project resource). A null
 *   `materialFinishId` is permitted and clears the saved finish.
 * - All schema failures are reported via `{ success: false, error }`
 *   rather than thrown.
 *
 * Side effects: performs a Prisma `room.update`; on success
 * revalidates `/projects/{projectId}` and `/preview/{projectId}` so
 * the saved-finish card updates on the next render.
 */
export async function saveRoomFinish(
  roomId: string,
  finish: RoomFinishInput
): Promise<
  { success: true } | { success: false; error: string }
> {
  const parsed = roomFinishSchema.safeParse(finish);
  if (!parsed.success) {
    return failure(
      parsed.error.issues[0]?.message ?? "Invalid room finish payload"
    );
  }

  const user = await getAuthedPrismaUser();
  if (!user) {
    return failure("Not authenticated");
  }

  const room = await prisma.room.findFirst({
    where: { id: roomId, project: { userId: user.id } },
    select: { id: true, projectId: true },
  });
  if (!room) {
    return failure("Room not found");
  }

  const data = parsed.data;

  // When a finish id is provided, it must belong to the room's
  // project. A swatch from another project would let a future render
  // reference a finish outside the room's contract.
  if (data.materialFinishId) {
    const swatch = await prisma.materialSwatch.findFirst({
      where: { id: data.materialFinishId, projectId: room.projectId },
      select: { id: true },
    });
    if (!swatch) {
      return failure("Material swatch not found in this project");
    }
  }

  try {
    await prisma.room.update({
      where: { id: roomId, project: { userId: user.id } },
      data: {
        materialFinishId: data.materialFinishId,
        materialFinishDirectives: data.materialFinishDirectives,
        materialFinishConceptLabel: data.materialFinishConceptLabel,
      },
    });
    revalidatePath(`/projects/${room.projectId}`);
    revalidatePath(`/preview/${room.projectId}`);
    return { success: true };
  } catch (error) {
    console.error(
      JSON.stringify({ event: "save_room_finish_failed", roomId }),
      error
    );
    return failure(error instanceof Error ? error.message : "Unknown error");
  }
}
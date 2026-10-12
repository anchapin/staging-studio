"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { projectMetadataSchema } from "@/lib/metadata-schemas";
import { revalidatePath } from "next/cache";

export async function bulkUpdateRoomAesthetic(
  roomIds: string[],
  aesthetic: string
): Promise<{ success: boolean; error?: string }> {
  if (!Array.isArray(roomIds) || roomIds.length === 0) {
    return { success: false, error: "No rooms provided" };
  }

  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  // Issue #1126: `aesthetic` reaches Prisma unvalidated otherwise. The
  // single-project metadata path (issue #682) caps every metadata field at
  // 2,000 characters; the bulk path now enforces the same cap through the
  // same schema. Empty string still parses: clearing is a legitimate
  // update. A non-string at the runtime server-action boundary is
  // rejected here too, instead of being written.
  const aestheticCheck = projectMetadataSchema
    .pick({ stagingAesthetic: true })
    .safeParse({ stagingAesthetic: aesthetic });
  if (!aestheticCheck.success) {
    return {
      success: false,
      error:
        aestheticCheck.error.issues[0]?.message ?? "Invalid staging aesthetic",
    };
  }

  try {
    const rooms = await prisma.room.findMany({
      where: { id: { in: roomIds } },
      select: { id: true, projectId: true, project: { select: { userId: true } } },
    });

    const invalid = rooms.filter((r) => r.project.userId !== user.id);
    if (invalid.length > 0) {
      return { success: false, error: "Some rooms are not owned by you" };
    }

    const projectIds = [...new Set(rooms.map((r) => r.projectId))];

    await prisma.project.updateMany({
      where: { id: { in: projectIds } },
      data: { stagingAesthetic: aesthetic },
    });

    for (const room of rooms) {
      revalidatePath(`/projects/${room.projectId}`);
      revalidatePath(`/preview/${room.projectId}`);
    }

    return { success: true };
  } catch (error) {
    console.error("Bulk update room failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

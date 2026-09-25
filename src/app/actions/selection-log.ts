"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { selectionLogSchema } from "@/lib/selection-log-schema";

/**
 * Server action: persists a selection toggle event to the durable SelectionLog table.
 *
 * Purpose: writes every instance toggle (both add and remove direction) to the
 * SelectionLog table for the training corpus (find-and-replace initiative,
 * issue #238 / wave W3). This makes the training data durable beyond the
 * browser console.
 *
 * Contract: requires an authenticated session. Input is validated through
 * `selectionLogSchema` (issue #714: concept ≤ 30 chars, editedLabel ≤ 60
 * chars, finite score, non-negative integer instanceIndex — unknown keys
 * rejected). Ownership is validated via the room's project -> user
 * relationship.
 *
 * Batching note: when many toggles fire rapidly (e.g. "select all detected"),
 * callers should rate-limit or batch calls. The export script handles bulk
 * reads; writes should aim for eventual consistency rather than per-toggle
 * synchronous writes if performance is a concern.
 */
export async function logSelectionEvent(input: {
  roomId: string;
  concept: string;
  instanceIndex: number;
  score: number;
  editedLabel?: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  try {
    // Bound every client-supplied field before it reaches Postgres
    // (issue #714): unbounded writes were a trivial bloat vector.
    const parsed = selectionLogSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ?? "Invalid selection event payload",
      };
    }
    const event = parsed.data;

    const user = await getAuthedPrismaUser();
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    // Validate ownership: verify the room belongs to a project owned by this user
    const room = await prisma.room.findFirst({
      where: {
        id: input.roomId,
        project: { userId: user.id },
      },
      select: { id: true },
    });

    if (!room) {
      return { success: false, error: "Room not found or access denied" };
    }

    await prisma.selectionLog.create({
      data: {
        roomId: event.roomId,
        concept: event.concept,
        instanceIndex: event.instanceIndex,
        score: event.score,
        editedLabel: event.editedLabel,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("[selection-log] failed to write:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

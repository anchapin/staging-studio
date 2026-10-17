"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  assertLookbookPinnable,
  slotToVariantIndex,
} from "@/lib/lookbook-variant";

function failure(error: string): { success: false; error: string } {
  return { success: false, error };
}

/**
 * Issue #1340 — Pins the room the lookbook picks up. React-side callers
 * (the version strip) use this action; non-React callers use the
 * sibling POST route `/api/lookbook-variant` (pinned by
 * `tests/api/lookbook-variant-route.test.ts`). Both share the
 * `slotToVariantIndex` resolver in `src/lib/lookbook-variant.ts` so
 * the column value is always derived from the slot id the same way.
 *
 * Returns `{ success: true }` on success, `{ success: false, error }`
 * for every failure mode. The shape is the project's standard one for
 * mutation actions (see `bulkUpdateRoomAesthetic` etc.) — wide enough
 * to surface a typed error without exploding on a Prisma write error.
 *
 * Issue #1225: every server action that mutates lookbook-rendered
 * data must call `revalidatePath("/preview/${projectId}")` alongside
 * its dashboard path. The static guard
 * `tests/revalidate-preview.test.ts` would fail this file if it
 * forgot — the explicit `expect(revalidatePath).toHaveBeenCalledWith(...)`
 * in the action test is the runtime half of the same contract.
 */
export async function setLookbookVariant(
  roomId: string,
  slot: "A" | "B" | "original"
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    // 1. Type-guard: the lookbook can only pin to A or B. Pinning to
    //    "original" is meaningless (the column stores 0 | 1 | null and
    //    `null` is reserved for "no active variant"), so we reject before
    //    touching the DB. The first-call pattern means the error message
    //    is the same one `slotToVariantIndex`'s public surface would
    //    surface to a programmatic caller.
    try {
      assertLookbookPinnable(slot);
    } catch (e) {
      return failure(
        e instanceof Error ? e.message : "Invalid slot"
      );
    }

    // 2. Auth gate.
    const user = await getAuthedPrismaUser();
    if (!user) return failure("Not authenticated");

    const variantIndex = slotToVariantIndex(slot);
    if (variantIndex === null) {
      // Belt-and-suspenders: assertLookbookPinnable already ruled this
      // out, but the type narrowing guards against a future SlotId
      // widening (TS keeps this correct if a new variant is added).
      return failure("Invalid slot");
    }

    // 3. Ownership — fetch the room with project.userId filter so an
    //    attacker can't flip another user's lookbook by guessing roomIds.
    const room = await prisma.room.findFirst({
      where: { id: roomId, project: { userId: user.id } },
      select: { id: true, projectId: true },
    });
    if (!room) return failure("Room not found");

    // 4. Update + revalidate.
    await prisma.room.update({
      where: { id: roomId },
      data: { selectedVariantIndex: variantIndex },
    });
    // Issue #1225: a /preview revalidation only stands next to a
    // /projects revalidation (the static guard at
    // tests/revalidate-preview.test.ts). Update both paths so the
    // dashboard mirrors the new lookbook slot on the next request.
    revalidatePath(`/projects/${room.projectId}`);
    revalidatePath(`/preview/${room.projectId}`);

    return { success: true };
  } catch (err) {
    console.error("[setLookbookVariant]", err);
    return failure(err instanceof Error ? err.message : "Unknown error");
  }
}

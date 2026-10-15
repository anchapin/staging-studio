import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { slotToVariantIndex } from "@/lib/lookbook-variant";
import {
  API_ERROR_INVALID_REQUEST,
  API_ERROR_ROOM_NOT_FOUND,
  API_ERROR_UNAUTHORIZED,
} from "@/lib/api-errors";

export const dynamic = "force-dynamic";

/**
 * Body schema for POST /api/lookbook-variant. The slot field is the
 * design's `SlotId` (`"A" | "B" | "original"`); "original" parses
 * but is rejected by the resolver because the lookbook cannot pin to
 * the source photo (the column's `null` value is reserved for
 * "no active variant").
 */
const lookbookVariantRequestSchema = z.object({
  roomId: z.string().min(1),
  slot: z.enum(["A", "B", "original"]),
});

/**
 * POST `/api/lookbook-variant`
 *
 * Mirrors the `setLookbookVariant` server action for non-React
 * callers (e2e specs, legacy surfaces during the migration, anything
 * that cannot use `"use server"`). The mutation lives in both places
 * because:
 *
 *  - The React-side version-strip call needs `"use server"` for
 *    progressive enhancement + cookie-bound session.
 *  - The Playwright e2e harness hits the route directly (a server
 *    action would go through `formAction={...}` and a serialized
 *    payload, which the route tests can't simulate cleanly).
 *
 * The two share the `slotToVariantIndex` resolver in
 * `src/lib/lookbook-variant.ts` so a wrong mapping fails both
 * test suites at once.
 *
 * Pinned by `tests/api/lookbook-variant-route.test.ts`.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Auth gate.
    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized", code: API_ERROR_UNAUTHORIZED },
        { status: 401 }
      );
    }

    // 2. Body validation. JSON-parse failures (malformed body, empty
    //    body) fall through to the same 400 path.
    const raw = await req.json().catch(() => null);
    const parsed = lookbookVariantRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          code: API_ERROR_INVALID_REQUEST,
          message: "Body must include a roomId and a slot of 'A', 'B', or 'original'.",
        },
        { status: 400 }
      );
    }
    const { roomId, slot } = parsed.data;

    // 3. Slot → variant index. The resolver returns null for
    //    "original" (the lookbook cannot pin to the source photo).
    //    Reject that case with 400 here so the route never reaches
    //    Prisma with a `null` it cannot store.
    const variantIndex = slotToVariantIndex(slot);
    if (variantIndex === null) {
      return NextResponse.json(
        {
          error: "Invalid request",
          code: API_ERROR_INVALID_REQUEST,
          message: 'Slot "original" cannot be pinned to the lookbook.',
        },
        { status: 400 }
      );
    }

    // 4. Ownership — fetch the room with project.userId filter.
    const room = await prisma.room.findFirst({
      where: { id: roomId, project: { userId: user.id } },
      select: { id: true, projectId: true },
    });
    if (!room) {
      return NextResponse.json(
        { error: "Room not found", code: API_ERROR_ROOM_NOT_FOUND },
        { status: 404 }
      );
    }

    // 5. Update + revalidate. The static guard at
    //    tests/revalidate-preview.test.ts fires when a /preview
    //    revalidation stands alone; pair it with /projects.
    await prisma.room.update({
      where: { id: roomId },
      data: { selectedVariantIndex: variantIndex },
    });
    revalidatePath(`/projects/${room.projectId}`);
    revalidatePath(`/preview/${room.projectId}`);

    return NextResponse.json({ variantIndex, roomId });
  } catch (err) {
    console.error("[lookbook-variant]", err);
    return NextResponse.json(
      {
        error: "Server error",
        code: "internal-server-error",
        message: "An unexpected error occurred.",
      },
      { status: 500 }
    );
  }
}

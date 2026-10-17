/**
 * Issue #1340 — `setLookbookVariant` server action.
 *
 * Pinned cases:
 *  - Rejects `"original"` slot before any prisma call (only A/B pinnable).
 *  - Returns `{ success: false, error: "Not authenticated" }` when the
 *    session is anonymous (defense-in-depth, defense-vs the `null` user).
 *  - Rejects rooms the user does not own (ownership filter).
 *  - Updates `Room.selectedVariantIndex` to 0 (for "A") or 1 (for "B")
 *    against the correct Prisma where-clause (room.id, project.userId).
 *  - On success, calls `revalidatePath("/preview/{projectId}")` per
 *    issue #1225 (preview freshness contract — pinned statically by
 *    `tests/revalidate-preview.test.ts` too).
 *  - Returns `{ success: true }` on the happy path.
 *
 * The route's sibling (`/api/lookbook-variant`) covers non-React callers
 * and is pinned by `tests/api/lookbook-variant-route.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import * as apiAuth from "@/lib/api-auth";
import * as prismaLib from "@/lib/prisma";
import { revalidatePath } from "next/cache";

import { setLookbookVariant } from "@/app/actions/lookbook-variant";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const USER_ID = "user-1";
const PROJECT_ID = "project-1";
const ROOM_ID = "room-1";

describe("setLookbookVariant (issue #1340)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects "original" before any auth or prisma call (lookbook cannot pin to source)', async () => {
    const result = await setLookbookVariant(ROOM_ID, "original");

    expect(result).toEqual({
      success: false,
      error: 'Lookbook cannot pin to slot "original" — only "A" or "B" are pinnable.',
    });
    expect(apiAuth.getAuthedPrismaUser).not.toHaveBeenCalled();
    expect(prismaLib.prisma.room.update).not.toHaveBeenCalled();
  });

  it('returns "Not authenticated" when there is no session', async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue(null as never);

    const result = await setLookbookVariant(ROOM_ID, "A");

    expect(result).toEqual({ success: false, error: "Not authenticated" });
    expect(prismaLib.prisma.room.update).not.toHaveBeenCalled();
  });

  it("rejects rooms the caller does not own", async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue({ id: USER_ID } as never);
    vi.mocked(prismaLib.prisma.room.findFirst).mockResolvedValue(null);

    const result = await setLookbookVariant(ROOM_ID, "A");

    expect(result).toEqual({ success: false, error: "Room not found" });
    expect(prismaLib.prisma.room.update).not.toHaveBeenCalled();
  });

  it('updates Room.selectedVariantIndex to 0 when slot is "A" and revalidates /projects/{projectId} + /preview/{projectId}', async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue({ id: USER_ID } as never);
    vi.mocked(prismaLib.prisma.room.findFirst).mockResolvedValue({
      id: ROOM_ID,
      projectId: PROJECT_ID,
      project: { userId: USER_ID },
    } as never);
    vi.mocked(prismaLib.prisma.room.update).mockResolvedValue({} as never);

    const result = await setLookbookVariant(ROOM_ID, "A");

    expect(result).toEqual({ success: true });
    expect(prismaLib.prisma.room.update).toHaveBeenCalledWith({
      where: { id: ROOM_ID },
      data: { selectedVariantIndex: 0 },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT_ID}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/preview/${PROJECT_ID}`);
  });

  it('updates Room.selectedVariantIndex to 1 when slot is "B"', async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue({ id: USER_ID } as never);
    vi.mocked(prismaLib.prisma.room.findFirst).mockResolvedValue({
      id: ROOM_ID,
      projectId: PROJECT_ID,
      project: { userId: USER_ID },
    } as never);
    vi.mocked(prismaLib.prisma.room.update).mockResolvedValue({} as never);

    const result = await setLookbookVariant(ROOM_ID, "B");

    expect(result).toEqual({ success: true });
    expect(prismaLib.prisma.room.update).toHaveBeenCalledWith({
      where: { id: ROOM_ID },
      data: { selectedVariantIndex: 1 },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/${PROJECT_ID}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/preview/${PROJECT_ID}`);
  });

  it("returns a typed error if the Prisma write throws", async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue({ id: USER_ID } as never);
    vi.mocked(prismaLib.prisma.room.findFirst).mockResolvedValue({
      id: ROOM_ID,
      projectId: PROJECT_ID,
      project: { userId: USER_ID },
    } as never);
    vi.mocked(prismaLib.prisma.room.update).mockRejectedValue(new Error("db is sad"));

    const result = await setLookbookVariant(ROOM_ID, "A");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("db is sad");
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

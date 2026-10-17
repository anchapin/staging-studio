/**
 * Issue #1340 — POST `/api/lookbook-variant` route.
 *
 * The route mirrors the `setLookbookVariant` server action for non-React
 * callers (e2e specs, the legacy secondary-pane strip during the
 * migration window, anything that cannot use `"use server"`).
 *
 * Coverage:
 *  - 401 when there is no authed user
 *  - 400 when the body is invalid (e.g. slot not in {A, B})
 *  - 404 when the room does not exist for the caller (ownership filter)
 *  - 200 with `{ variantIndex }` on the happy path; the Prisma update
 *    targets `selectedVariantIndex` to the resolved index
 *  - Defers `data` to the action's coverage — the route forwards slot
 *    ids to the same `slotToVariantIndex` resolver the action uses, so
 *    a wrong mapping would fail here AND in the action test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/lookbook-variant/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const USER_ID = "user-1";
const PROJECT_ID = "project-1";
const ROOM_ID = "room-1";

function callRoute(body: unknown): Promise<Response> {
  const req = new Request("http://localhost/api/lookbook-variant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req as unknown as Parameters<typeof POST>[0]);
}

describe("POST /api/lookbook-variant (issue #1340)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when there is no authed user", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const res = await callRoute({ roomId: ROOM_ID, slot: "A" });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(prisma.room.findFirst).not.toHaveBeenCalled();
    expect(prisma.room.update).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is malformed (missing slot)", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue({ id: USER_ID } as never);

    const res = await callRoute({ roomId: ROOM_ID });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid request");
    expect(prisma.room.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 when slot is "original" (lookbook cannot pin to source)', async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue({ id: USER_ID } as never);

    const res = await callRoute({ roomId: ROOM_ID, slot: "original" });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid request");
    expect(prisma.room.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when the room does not exist for the caller", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue({ id: USER_ID } as never);
    vi.mocked(prisma.room.findFirst).mockResolvedValue(null);

    const res = await callRoute({ roomId: ROOM_ID, slot: "A" });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Room not found");
    expect(prisma.room.update).not.toHaveBeenCalled();
  });

  it('returns 200 with { variantIndex: 0 } when slot is "A"', async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue({ id: USER_ID } as never);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({
      id: ROOM_ID,
      projectId: PROJECT_ID,
      project: { userId: USER_ID },
    } as never);
    vi.mocked(prisma.room.update).mockResolvedValue({} as never);

    const res = await callRoute({ roomId: ROOM_ID, slot: "A" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ variantIndex: 0, roomId: ROOM_ID });
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: ROOM_ID },
      data: { selectedVariantIndex: 0 },
    });
  });

  it('returns 200 with { variantIndex: 1 } when slot is "B"', async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue({ id: USER_ID } as never);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({
      id: ROOM_ID,
      projectId: PROJECT_ID,
      project: { userId: USER_ID },
    } as never);
    vi.mocked(prisma.room.update).mockResolvedValue({} as never);

    const res = await callRoute({ roomId: ROOM_ID, slot: "B" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ variantIndex: 1, roomId: ROOM_ID });
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: ROOM_ID },
      data: { selectedVariantIndex: 1 },
    });
  });
});

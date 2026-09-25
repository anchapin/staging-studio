import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { restoreInpaintVersion } from "@/app/actions/inpaint-versions";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: { update: vi.fn() },
    inpaintVersion: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: vi.fn(),
}));

const findUnique = prisma.inpaintVersion.findUnique as unknown as Mock;
const roomUpdate = prisma.room.update as unknown as Mock;
const authedUser = getAuthedPrismaUser as unknown as Mock;
const revalidate = revalidatePath as unknown as Mock;

const USER_ID = "user-1";
const PROJECT_ID = "project-1";
const ROOM_ID = "room-1";
const VERSION_ID = "version-1";
const RESULT_URL = "https://fal.media/result-1.png";

beforeEach(() => {
  vi.resetAllMocks();
  authedUser.mockResolvedValue({ id: USER_ID });
  roomUpdate.mockResolvedValue({});
  findUnique.mockResolvedValue({
    id: VERSION_ID,
    roomId: ROOM_ID,
    variantSlot: 0,
    resultUrl: RESULT_URL,
    room: {
      id: ROOM_ID,
      project: { id: PROJECT_ID, userId: USER_ID },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("restoreInpaintVersion — revalidation target (issue #701)", () => {
  it("revalidates the project path (and lookbook), not the user path", async () => {
    const result = await restoreInpaintVersion(VERSION_ID);

    expect(result).toEqual({ success: true });
    expect(roomUpdate).toHaveBeenCalledWith({
      where: { id: ROOM_ID },
      data: { afterImageUrl: RESULT_URL },
    });
    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(revalidate).toHaveBeenNthCalledWith(1, `/projects/${PROJECT_ID}`);
    expect(revalidate).toHaveBeenNthCalledWith(2, `/projects/${PROJECT_ID}/lookbook`);
    // The old bug revalidated /projects/{userId} — a route that does not exist.
    expect(revalidate).not.toHaveBeenCalledWith(`/projects/${USER_ID}`);
  });

  it("targets the variant-2 column and still revalidates the project path", async () => {
    findUnique.mockResolvedValue({
      id: VERSION_ID,
      roomId: ROOM_ID,
      variantSlot: 1,
      resultUrl: RESULT_URL,
      room: {
        id: ROOM_ID,
        project: { id: PROJECT_ID, userId: USER_ID },
      },
    });

    const result = await restoreInpaintVersion(VERSION_ID);

    expect(result).toEqual({ success: true });
    expect(roomUpdate).toHaveBeenCalledWith({
      where: { id: ROOM_ID },
      data: { afterImageUrl2: RESULT_URL },
    });
    expect(revalidate).toHaveBeenCalledWith(`/projects/${PROJECT_ID}`);
    expect(revalidate).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/lookbook`);
  });

  it("fails closed without revalidating when the version is not owned", async () => {
    findUnique.mockResolvedValue({
      id: VERSION_ID,
      roomId: ROOM_ID,
      variantSlot: 0,
      resultUrl: RESULT_URL,
      room: {
        id: ROOM_ID,
        project: { id: PROJECT_ID, userId: "someone-else" },
      },
    });

    const result = await restoreInpaintVersion(VERSION_ID);

    expect(result).toEqual({
      success: false,
      error: "Version not found or not owned by user",
    });
    expect(roomUpdate).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });
});

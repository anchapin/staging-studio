import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted so the mock is fresh for each test run and doesn't retain
// state from the full suite run
const mockPrisma = vi.hoisted(() => ({
  room: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  materialSwatch: {
    findFirst: vi.fn(),
  },
}));

const mockGetAuthedPrismaUser = vi.hoisted(() => vi.fn());
const mockRevalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: mockGetAuthedPrismaUser,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { saveRoomFinish } from "@/app/actions/room-finish";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";
const MOCK_PROJECT_ID = "cproj12345678901234567890";
const MOCK_SWATCH_ID = "cswch12345678901234567890";

// Tests always pass all three fields; empty strings are normalized to
// null by the schema (issue #1182: a "Clear" action rides the same path).
const EMPTY = {
  materialFinishId: null,
  materialFinishDirectives: null,
  materialFinishConceptLabel: null,
} as const;

describe("saveRoomFinish (issue #1182)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockPrisma.room.findFirst)
      .mockReset()
      .mockResolvedValue({
        id: MOCK_ROOM_ID,
        projectId: MOCK_PROJECT_ID,
      } as never);
    vi.mocked(mockPrisma.room.update)
      .mockReset()
      .mockResolvedValue({ id: MOCK_ROOM_ID } as never);
    vi.mocked(mockPrisma.materialSwatch.findFirst)
      .mockReset()
      .mockResolvedValue({ id: MOCK_SWATCH_ID } as never);
    vi.mocked(mockGetAuthedPrismaUser)
      .mockReset()
      .mockResolvedValue({ id: MOCK_USER_ID, email: "test@example.com" } as never);
    vi.mocked(mockRevalidatePath).mockReset();
  });

  it("returns Not authenticated when there is no session", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const result = await saveRoomFinish(MOCK_ROOM_ID, {
      materialFinishId: MOCK_SWATCH_ID,
      materialFinishDirectives: "warm wood tones",
      materialFinishConceptLabel: null,
    });

    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe(
      "Not authenticated"
    );
    expect(prisma.room.update).not.toHaveBeenCalled();
  });

  it("returns Room not found when ownership check fails", async () => {
    vi.mocked(prisma.room.findFirst).mockResolvedValue(null);

    const result = await saveRoomFinish(MOCK_ROOM_ID, {
      materialFinishId: MOCK_SWATCH_ID,
      materialFinishDirectives: null,
      materialFinishConceptLabel: null,
    });

    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe(
      "Room not found"
    );
    expect(prisma.room.update).not.toHaveBeenCalled();
  });

  it("rejects a swatch id that does not belong to the room's project", async () => {
    vi.mocked(prisma.materialSwatch.findFirst).mockResolvedValue(null);

    const result = await saveRoomFinish(MOCK_ROOM_ID, {
      materialFinishId: MOCK_SWATCH_ID,
      materialFinishDirectives: null,
      materialFinishConceptLabel: null,
    });

    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe(
      "Material swatch not found in this project"
    );
    expect(prisma.room.update).not.toHaveBeenCalled();
  });

  it("saves a finish and revalidates the project + preview paths", async () => {
    const result = await saveRoomFinish(MOCK_ROOM_ID, {
      materialFinishId: MOCK_SWATCH_ID,
      materialFinishDirectives:
        "Use warm white oak floors with brushed brass hardware",
      materialFinishConceptLabel: "flooring",
    });

    expect(result).toEqual({ success: true });
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: MOCK_ROOM_ID, project: { userId: MOCK_USER_ID } },
      data: {
        materialFinishId: MOCK_SWATCH_ID,
        materialFinishDirectives:
          "Use warm white oak floors with brushed brass hardware",
        materialFinishConceptLabel: "flooring",
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/projects/${MOCK_PROJECT_ID}`
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/preview/${MOCK_PROJECT_ID}`
    );
  });

  it("normalizes empty strings to null so a Clear action can ride the same path", async () => {
    const result = await saveRoomFinish(MOCK_ROOM_ID, {
      materialFinishId: "",
      materialFinishDirectives: "",
      materialFinishConceptLabel: "",
    });

    expect(result).toEqual({ success: true });
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: MOCK_ROOM_ID, project: { userId: MOCK_USER_ID } },
      data: {
        materialFinishId: null,
        materialFinishDirectives: null,
        materialFinishConceptLabel: null,
      },
    });
  });

  it("clearing a finish does not require a swatch lookup", async () => {
    const result = await saveRoomFinish(MOCK_ROOM_ID, EMPTY);

    expect(result).toEqual({ success: true });
    expect(prisma.materialSwatch.findFirst).not.toHaveBeenCalled();
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: MOCK_ROOM_ID, project: { userId: MOCK_USER_ID } },
      data: EMPTY,
    });
  });

  it("rejects unknown keys via the schema strict() guard", async () => {
    const result = await saveRoomFinish(MOCK_ROOM_ID, {
      materialFinishId: MOCK_SWATCH_ID,
      materialFinishDirectives: null,
      materialFinishConceptLabel: null,
      // @ts-expect-error — exercising the strict() guard
      projectId: "hijack",
    });

    expect(result.success).toBe(false);
    expect(prisma.room.update).not.toHaveBeenCalled();
  });

  it("returns a friendly error when the update throws", async () => {
    vi.mocked(prisma.room.update).mockRejectedValue(new Error("db is down"));

    const result = await saveRoomFinish(MOCK_ROOM_ID, {
      materialFinishId: MOCK_SWATCH_ID,
      materialFinishDirectives: null,
      materialFinishConceptLabel: null,
    });

    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe(
      "db is down"
    );
  });
});
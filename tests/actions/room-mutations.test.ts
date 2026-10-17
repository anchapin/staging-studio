import { describe, it, expect, vi, beforeEach } from "vitest";
import { bulkUpdateRoomAesthetic } from "@/app/actions/room-mutations";
import * as apiAuth from "@/lib/api-auth";
import * as prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: {
      findMany: vi.fn(),
    },
    project: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("bulkUpdateRoomAesthetic (issue #1126)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when no rooms are provided", async () => {
    const result = await bulkUpdateRoomAesthetic([], "Modern Farmhouse");

    expect(result).toEqual({ success: false, error: "No rooms provided" });
    expect(apiAuth.getAuthedPrismaUser).not.toHaveBeenCalled();
  });

  it("returns error when not authenticated", async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue(null as never);

    const result = await bulkUpdateRoomAesthetic(["room-1"], "Modern Farmhouse");

    expect(result).toEqual({ success: false, error: "Not authenticated" });
    expect(prisma.prisma.room.findMany).not.toHaveBeenCalled();
  });

  it("rejects an aesthetic longer than 2,000 characters before any prisma call", async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue({ id: "user-1" } as never);

    const result = await bulkUpdateRoomAesthetic(["room-1"], "a".repeat(2001));

    expect(result.success).toBe(false);
    expect(result.error).toContain("2,000 characters");
    // Validation is enforced through the same schema as the single-project
    // metadata path (issue #682) and must fire before any read or write.
    expect(prisma.prisma.room.findMany).not.toHaveBeenCalled();
    expect(prisma.prisma.project.updateMany).not.toHaveBeenCalled();
  });

  it("accepts an empty aesthetic (clearing is a legitimate update)", async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(prisma.prisma.room.findMany).mockResolvedValue([
      {
        id: "room-1",
        projectId: "project-1",
        project: { userId: "user-1" },
      },
    ] as never);

    const result = await bulkUpdateRoomAesthetic(["room-1"], "");

    expect(result).toEqual({ success: true });
    expect(prisma.prisma.project.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["project-1"] } },
        data: { stagingAesthetic: "" },
      })
    );
  });

  it("writes stagingAesthetic to the touched projects and revalidates", async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(prisma.prisma.room.findMany).mockResolvedValue([
      {
        id: "room-1",
        projectId: "project-1",
        project: { userId: "user-1" },
      },
      {
        id: "room-2",
        projectId: "project-2",
        project: { userId: "user-1" },
      },
    ] as never);

    const result = await bulkUpdateRoomAesthetic(
      ["room-1", "room-2"],
      "Modern Farmhouse"
    );

    expect(result).toEqual({ success: true });
    expect(prisma.prisma.project.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["project-1", "project-2"] } },
        data: { stagingAesthetic: "Modern Farmhouse" },
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1");
    expect(revalidatePath).toHaveBeenCalledWith("/preview/project-1");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-2");
    expect(revalidatePath).toHaveBeenCalledWith("/preview/project-2");
  });

  it("rejects rooms that are not owned by the caller before writing", async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(prisma.prisma.room.findMany).mockResolvedValue([
      {
        id: "room-1",
        projectId: "project-1",
        project: { userId: "someone-else" },
      },
    ] as never);

    const result = await bulkUpdateRoomAesthetic(["room-1"], "Modern Farmhouse");

    expect(result).toEqual({
      success: false,
      error: "Some rooms are not owned by you",
    });
    expect(prisma.prisma.project.updateMany).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

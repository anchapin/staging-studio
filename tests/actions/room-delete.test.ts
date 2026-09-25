import { describe, it, expect, vi, beforeEach } from "vitest";
import { deleteRoom } from "@/app/actions/room-delete";
import * as apiAuth from "@/lib/api-auth";
import * as prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: {
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("deleteRoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when not authenticated", async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue(null as any);

    const result = await deleteRoom("room-1");

    expect(result).toEqual({ success: false, error: "Not authenticated" });
    expect(apiAuth.getAuthedPrismaUser).toHaveBeenCalledOnce();
    expect(prisma.prisma.room.findFirst).not.toHaveBeenCalled();
  });

  it("returns error when room is not found", async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue({ id: "user-1" } as any);
    vi.mocked(prisma.prisma.room.findFirst).mockResolvedValue(null);

    const result = await deleteRoom("room-nonexistent");

    expect(result).toEqual({ success: false, error: "Room not found" });
    expect(prisma.prisma.room.findFirst).toHaveBeenCalledWith({
      where: { id: "room-nonexistent", project: { userId: "user-1" } },
      select: { id: true, projectId: true },
    });
  });

  it("returns error when user does not own the room's project", async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue({ id: "user-1" } as any);
    vi.mocked(prisma.prisma.room.findFirst).mockResolvedValue(null);

    const result = await deleteRoom("room-other-user");

    expect(result).toEqual({ success: false, error: "Room not found" });
  });

  it("successfully deletes room and cascades related records", async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue({ id: "user-1" } as any);
    vi.mocked(prisma.prisma.room.findFirst).mockResolvedValue({
      id: "room-1",
      projectId: "project-1",
    } as any);
    vi.mocked(prisma.prisma.room.delete).mockResolvedValue({ id: "room-1" } as any);

    const result = await deleteRoom("room-1");

    expect(result).toEqual({ success: true });
    expect(prisma.prisma.room.delete).toHaveBeenCalledWith({ where: { id: "room-1" } });
    const { revalidatePath } = await import("next/cache");
    expect(revalidatePath).toHaveBeenCalledWith("/projects/project-1/rooms");
  });

  it("returns error on database error during delete", async () => {
    vi.mocked(apiAuth.getAuthedPrismaUser).mockResolvedValue({ id: "user-1" } as any);
    vi.mocked(prisma.prisma.room.findFirst).mockResolvedValue({
      id: "room-1",
      projectId: "project-1",
    } as any);
    vi.mocked(prisma.prisma.room.delete).mockRejectedValue(new Error("Database error"));

    const result = await deleteRoom("room-1");

    expect(result).toEqual({ success: false, error: "Database error" });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: {
      findFirst: vi.fn(),
    },
    selectionLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

const mockUser = { id: "user-1", email: "test@example.com", firmName: "Test Firm", firmLogoUrl: null, pageTemplate: null, darkMode: false };

beforeEach(() => {
  vi.clearAllMocks();
});

import { logSelectionEvent } from "@/app/actions/selection-log";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

describe("logSelectionEvent", () => {
  const baseEvent = {
    roomId: "room-1",
    concept: "sofa",
    instanceIndex: 0,
    score: 0.95,
  };

  it("returns error when not authenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const result = await logSelectionEvent(baseEvent);

    expect(result).toEqual({ success: false, error: "Unauthorized" });
  });

  it("returns error when room not found or access denied", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.findFirst).mockResolvedValue(null);

    const result = await logSelectionEvent(baseEvent);

    expect(result).toEqual({ success: false, error: "Room not found or access denied" });
  });

  it("creates selection log entry on success", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({ id: "room-1" });
    vi.mocked(prisma.selectionLog.create).mockResolvedValue({
      id: "log-1",
      roomId: baseEvent.roomId,
      concept: baseEvent.concept,
      instanceIndex: baseEvent.instanceIndex,
      score: baseEvent.score,
      editedLabel: null,
      userId: mockUser.id,
      imageUrl: "",
      imageUrlHash: "",
      projectId: "",
      timestamp: new Date(),
    });

    const result = await logSelectionEvent(baseEvent);

    expect(result).toEqual({ success: true });
    expect(prisma.selectionLog.create).toHaveBeenCalledWith({
      data: {
        roomId: baseEvent.roomId,
        concept: baseEvent.concept,
        instanceIndex: baseEvent.instanceIndex,
        score: baseEvent.score,
      },
    });
  });

  it("passes through database errors", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({ id: "room-1" });
    vi.mocked(prisma.selectionLog.create).mockRejectedValue(new Error("Connection lost"));

    const result = await logSelectionEvent(baseEvent);

    expect(result).toEqual({ success: false, error: "Connection lost" });
  });

  it("accepts optional editedLabel", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({ id: "room-1" });
    vi.mocked(prisma.selectionLog.create).mockResolvedValue({
      id: "log-1",
      roomId: baseEvent.roomId,
      concept: baseEvent.concept,
      instanceIndex: baseEvent.instanceIndex,
      score: baseEvent.score,
      editedLabel: "Modern Sectional",
      userId: mockUser.id,
      imageUrl: "",
      imageUrlHash: "",
      projectId: "",
      timestamp: new Date(),
    });

    const result = await logSelectionEvent({ ...baseEvent, editedLabel: "Modern Sectional" });

    expect(result).toEqual({ success: true });
    expect(prisma.selectionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        editedLabel: "Modern Sectional",
      }),
    });
  });

  it("returns validation error for invalid concept", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({ id: "room-1" });

    // concept > 30 chars should fail
    const longConcept = "a".repeat(31);
    const result = await logSelectionEvent({ ...baseEvent, concept: longConcept });

    expect(result.success).toBe(false);
    expect(result.error).toContain("30 characters");
  });
});

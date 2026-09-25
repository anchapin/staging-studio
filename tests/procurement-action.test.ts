import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    procurementItem: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
  requireProjectOwnershipSafe: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firmName: "Test Firm",
  ownerName: "Test Owner",
  logoUrl: null,
  psychologyPageContent: null,
  signoffContent: null,
  darkMode: false,
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

import { saveProcurementItems } from "@/app/actions/procurement";
import { getAuthedPrismaUser, requireProjectOwnershipSafe } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

describe("saveProcurementItems", () => {
  const projectId = "c123456789012345678901234";
  const validItems = [
    {
      item: "West Elm sofa",
      category: "Furniture",
    },
  ];

  it("returns error when not authenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const result = await saveProcurementItems(projectId, validItems);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("returns error when project not found", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(requireProjectOwnershipSafe).mockResolvedValue(null);

    const result = await saveProcurementItems(projectId, validItems);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("deletes existing items and creates new ones on success", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(requireProjectOwnershipSafe).mockResolvedValue({ project: { id: projectId } as any});

    const result = await saveProcurementItems(projectId, validItems);

    expect(result).toEqual({ success: true });
    expect(prisma.procurementItem.deleteMany).toHaveBeenCalledWith({
      where: { projectId },
    });
    expect(prisma.procurementItem.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          item: validItems[0].item,
          category: validItems[0].category,
        }),
      ]),
    });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("returns error when database operation fails", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(requireProjectOwnershipSafe).mockResolvedValue({ project: { id: projectId } as any });
    vi.mocked(prisma.procurementItem.deleteMany).mockRejectedValue(new Error("DB error"));

    const result = await saveProcurementItems(projectId, validItems);

    expect(result).toEqual({ success: false, error: "DB error" });
  });

  it("returns error for invalid item data", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(requireProjectOwnershipSafe).mockResolvedValue({ project: { id: projectId } as any });

    const result = await saveProcurementItems(projectId, [{ item: "", category: "Seating" }]);

    expect(result.success).toBe(false);
  });
});

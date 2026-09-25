import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    materialSwatch: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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

import { saveMaterialSwatch, deleteMaterialSwatch } from "@/app/actions/material-swatch";
import { getAuthedPrismaUser, requireProjectOwnershipSafe } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

describe("saveMaterialSwatch", () => {
  const projectId = "c123456789012345678901234";
  const validSwatch = {
    name: "Velvet Navy",
    hexCode: "#1a237e",
    materialType: "Fabric",
    useCase: "Sofa",
  };

  it("returns error when not authenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const result = await saveMaterialSwatch(projectId, validSwatch);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("returns error when project not found", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(requireProjectOwnershipSafe).mockResolvedValue(null);

    const result = await saveMaterialSwatch(projectId, validSwatch);

    expect(result).toEqual({ success: false, error: "Project not found" });
  });

  it("creates material swatch on success", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(requireProjectOwnershipSafe).mockResolvedValue({ project: { id: projectId } as any });
    vi.mocked(prisma.materialSwatch.create).mockResolvedValue({
      id: "swatch-1",
      projectId,
      name: validSwatch.name,
      hexCode: validSwatch.hexCode,
      materialType: validSwatch.materialType,
      useCase: validSwatch.useCase,
      vendor: null,
      sku: null,
      sortOrder: 0,
    });

    const result = await saveMaterialSwatch(projectId, validSwatch);

    expect(result.success).toBe(true);
    expect(prisma.materialSwatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId,
          name: validSwatch.name,
          hexCode: validSwatch.hexCode,
          materialType: validSwatch.materialType,
          useCase: validSwatch.useCase,
        }),
      })
    );
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("propagates database errors", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(requireProjectOwnershipSafe).mockResolvedValue({ project: { id: projectId } as any });
    vi.mocked(prisma.materialSwatch.create).mockRejectedValue(new Error("DB error"));

    const result = await saveMaterialSwatch(projectId, validSwatch);

    expect(result).toEqual({ success: false, error: "DB error" });
  });
});

describe("deleteMaterialSwatch", () => {
  const projectId = "c123456789012345678901234";
  const swatchId = "swatch-1";

  it("returns error when not authenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const result = await deleteMaterialSwatch(projectId, swatchId);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("returns error when project not found", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(requireProjectOwnershipSafe).mockResolvedValue(null);

    const result = await deleteMaterialSwatch(projectId, swatchId);

    expect(result).toEqual({ success: false, error: "Project not found" });
  });

  it("deletes swatch and revalidates path on success", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(requireProjectOwnershipSafe).mockResolvedValue({ project: { id: projectId } as any });
    vi.mocked(prisma.materialSwatch.delete).mockResolvedValue({
      id: swatchId,
      projectId,
      name: "Velvet Navy",
      hexCode: "#1a237e",
      materialType: "Fabric",
      useCase: "Sofa",
      vendor: null,
      sku: null,
      sortOrder: 0,
    });

    const result = await deleteMaterialSwatch(projectId, swatchId);

    expect(result).toEqual({ success: true });
    expect(prisma.materialSwatch.delete).toHaveBeenCalledWith({
      where: { id: swatchId, projectId },
    });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("propagates database errors", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(requireProjectOwnershipSafe).mockResolvedValue({ project: { id: projectId } as any });
    vi.mocked(prisma.materialSwatch.delete).mockRejectedValue(new Error("DB error"));

    const result = await deleteMaterialSwatch(projectId, swatchId);

    expect(result).toEqual({ success: false, error: "DB error" });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/signature-encryption", () => ({
  encryptSignature: vi.fn().mockImplementation((data: string) => Promise.resolve(`encrypted_${data}`)),
  decryptSignature: vi.fn().mockImplementation((data: string) => Promise.resolve(data.replace("encrypted_", ""))),
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

// Project IDs must match PROJECT_ID_PATTERN: /^c[a-z0-9]{24}$/
const validProjectId = "c123456789012345678901234";

beforeEach(() => {
  vi.clearAllMocks();
});

import { saveProjectMetadata, saveProjectSignature } from "@/app/actions/project";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

describe("saveProjectMetadata", () => {
  const validMeta = {
    propertyAddress: "123 Main St",
    clientName: "John Doe",
    targetBuyer: "Young professional",
    stagingAesthetic: "modern",
    stagingPackage: "full",
    stagingDirectives: "Make it pop",
  };

  it("returns error when not authenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const result = await saveProjectMetadata(validProjectId, validMeta);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("updates project metadata and revalidates paths on success", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.project.update).mockResolvedValue({
      id: validProjectId,
      userId: mockUser.id,
      propertyAddress: "123 Main St",
      clientName: "John Doe",
      targetBuyer: "Young professional",
      stagingAesthetic: "modern",
      stagingPackage: "full",
      stagingDirectives: "Make it pop",
      buyerDemographics: {},
      roiSalesPricePremium: "0",
      roiTransactionVelocity: "faster",
      roiInvestmentTier: "mid",
      clientSignature: null,
      clientSignatureStatus: null,
      clientSignatureTimestamp: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await saveProjectMetadata(validProjectId, validMeta);

    expect(result).toEqual({ success: true });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: validProjectId, userId: mockUser.id },
      data: expect.objectContaining({
        propertyAddress: validMeta.propertyAddress,
        clientName: validMeta.clientName,
        targetBuyer: validMeta.targetBuyer,
        stagingAesthetic: validMeta.stagingAesthetic,
        stagingPackage: validMeta.stagingPackage,
        stagingDirectives: validMeta.stagingDirectives,
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/${validProjectId}`);
  });

  it("propagates unexpected database errors", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.project.update).mockRejectedValue(new Error("Connection error"));

    const result = await saveProjectMetadata(validProjectId, validMeta);

    expect(result).toEqual({ success: false, error: "Connection error" });
  });

  it("returns validation error for empty metadata", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);

    const result = await saveProjectMetadata(validProjectId, {});

    expect(result.success).toBe(false);
  });
});

describe("saveProjectSignature", () => {
  it("returns error when not authenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const result = await saveProjectSignature(validProjectId, "data:image/png;base64,abc123");

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("returns error when project not found", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.project.update).mockRejectedValue(new Error("Project not found"));

    const result = await saveProjectSignature(validProjectId, "data:image/png;base64,abc123");

    expect(result).toEqual({ success: false, error: "Project not found" });
  });

  it("saves signature with Signed status and revalidates paths", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.project.update).mockResolvedValue({
      id: validProjectId,
      userId: mockUser.id,
      propertyAddress: "123 Main St",
      clientName: "John Doe",
      targetBuyer: "Young professional",
      stagingAesthetic: "modern",
      stagingPackage: "full",
      stagingDirectives: "Make it pop",
      buyerDemographics: {},
      roiSalesPricePremium: "0",
      roiTransactionVelocity: "faster",
      roiInvestmentTier: "mid",
      clientSignature: "encrypted_data:image/png;base64,abc123",
      clientSignatureStatus: "Signed",
      clientSignatureTimestamp: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await saveProjectSignature(validProjectId, "data:image/png;base64,abc123");

    expect(result).toEqual({ success: true });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: validProjectId, userId: mockUser.id },
      data: {
        clientSignature: "encrypted_data:image/png;base64,abc123",
        clientSignatureStatus: "Signed",
        clientSignatureTimestamp: expect.any(Date),
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/${validProjectId}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/${validProjectId}/lookbook`);
  });

  it("propagates unexpected errors", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.project.update).mockRejectedValue(new Error("DB failure"));

    const result = await saveProjectSignature(validProjectId, "data:image/png;base64,abc");

    expect(result).toEqual({ success: false, error: "DB failure" });
  });

  it("returns validation error for invalid project ID format", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);

    const result = await saveProjectSignature("invalid-id", "data:image/png;base64,abc");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid project id format");
  });

  it("returns validation error for missing signature data", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);

    const result = await saveProjectSignature(validProjectId, "");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Signature must be a PNG data URL");
  });
});

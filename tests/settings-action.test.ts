import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
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

import { updateUserSettings } from "@/app/actions/settings";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

describe("updateUserSettings", () => {
  const validSettings = {
    firmName: "Circle G Designs",
    ownerName: "John Doe",
    logoUrl: "",
    psychologyPageContent: "",
    signoffContent: "",
    darkMode: true,
  };

  it("returns error when not authenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const result = await updateUserSettings(validSettings);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("updates user settings and revalidates path on success", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: mockUser.id,
      email: mockUser.email,
      firmName: validSettings.firmName,
      ownerName: validSettings.ownerName,
      logoUrl: validSettings.logoUrl,
      psychologyPageContent: null,
      signoffContent: null,
      darkMode: validSettings.darkMode,
      createdAt: new Date(),
    });

    const result = await updateUserSettings(validSettings);

    expect(result).toEqual({ success: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: mockUser.id },
      data: expect.objectContaining({
        firmName: validSettings.firmName,
        ownerName: validSettings.ownerName,
        darkMode: validSettings.darkMode,
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("propagates database errors as failures", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.user.update).mockRejectedValue(new Error("DB error"));

    const result = await updateUserSettings(validSettings);

    expect(result).toEqual({ success: false, error: "DB error" });
  });
});

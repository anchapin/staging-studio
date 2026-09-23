import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
const mockPrisma = {
  project: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
};

const mockGetAuthedPrismaUser = vi.fn();

const mockGetDailyUsage = vi.fn();

const mockDetectRoomType = vi.fn();

const mockEvaluateDailyBatchQuota = vi.fn();

const mockRecordDailyUsage = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: mockGetAuthedPrismaUser,
}));

vi.mock("@/lib/room-type-detection", () => ({
  detectRoomType: mockDetectRoomType,
}));

vi.mock("@/lib/api-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-quota")>();
  return {
    ...actual,
    getDailyUsage: mockGetDailyUsage,
    evaluateDailyBatchQuota: mockEvaluateDailyBatchQuota,
    recordDailyUsage: mockRecordDailyUsage,
  };
});

// Re-import after mocks are set up
const { detectBatchRoomTypes } = await import(
  "@/app/actions/room-batch"
);

describe("detectBatchRoomTypes", () => {
  const mockUser = {
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
    firmName: "Test Firm",
    supabaseUserId: "supabase-user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    darkMode: false,
  };

  const mockProject = {
    id: "project-1",
    userId: mockUser.id,
    name: "Test Project",
    status: "Active" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    clientSignature: null,
    clientSignatureStatus: null,
    clientSignatureTimestamp: null,
    // Room fields (nullable for project-level calls)
    roomType: null,
    stagingAesthetic: null,
    stagingPackage: null,
    stagingDirectives: null,
    buyerDemographics: null,
    roiSalesPricePremium: null,
    roiTransactionVelocity: null,
    roiInvestmentTier: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    clientName: null,
    clientEmail: null,
    clientPhone: null,
    targetBuyer: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthedPrismaUser.mockResolvedValue(mockUser);
    mockPrisma.project.findFirst.mockResolvedValue(mockProject);
    mockPrisma.project.findUnique.mockResolvedValue(mockProject);
  });

  it("rejects when daily label quota is exceeded (issue #790)", async () => {
    const imageUrls = [
      "https://room1.jpg.supabase.co/storage/v1/object/public/rooms/room1.jpg",
      "https://room2.jpg.supabase.co/storage/v1/object/public/rooms/room2.jpg",
    ];

    // Simulate quota exceeded - remaining quota (0) < requested count (2)
    mockEvaluateDailyBatchQuota.mockReturnValue({
      allowed: false,
      used: 20,
      requested: 2,
      limit: 20,
      remaining: 0,
    });

    const result = await detectBatchRoomTypes(mockProject.id, imageUrls);

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("today's limit"),
    });

    expect(mockPrisma.project.findFirst).not.toHaveBeenCalled();
    // Verify no AI calls were made
    expect(mockDetectRoomType).not.toHaveBeenCalled();
    // Verify no usage was recorded
    expect(mockRecordDailyUsage).not.toHaveBeenCalled();
  });

  it("allows batch when quota is within limits", async () => {
    const imageUrls = [
      "https://room1.jpg.supabase.co/storage/v1/object/public/rooms/room1.jpg",
    ];

    mockEvaluateDailyBatchQuota.mockReturnValue({
      allowed: true,
      used: 5,
      requested: 1,
      limit: 20,
      remaining: 15,
    });

    mockDetectRoomType.mockResolvedValue("Living Room");
    mockRecordDailyUsage.mockResolvedValue(6); // returns updated used count

    const result = await detectBatchRoomTypes(mockProject.id, imageUrls);

    expect(result).toEqual({
      success: true,
      roomTypes: ["Living Room"],
    });

    // Verify usage was recorded BEFORE the AI call
    expect(mockRecordDailyUsage).toHaveBeenCalledWith(
      "label",
      mockUser.id
    );
    expect(mockRecordDailyUsage).toHaveBeenCalledTimes(1);
    // Verify AI was called after quota consumption
    expect(mockDetectRoomType).toHaveBeenCalledWith(imageUrls[0]);
  });
});

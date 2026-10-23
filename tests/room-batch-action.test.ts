import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
const mockPrisma = {
  project: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
};

const mockGetAuthedPrismaUser = vi.fn();

const mockRequireProjectOwnershipSafe = vi.fn();

const mockDetectRoomType = vi.fn();

const mockClaimDailyQuota = vi.fn();

const mockRefundDailyQuota = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: mockGetAuthedPrismaUser,
  requireProjectOwnershipSafe: mockRequireProjectOwnershipSafe,
}));

vi.mock("@/lib/room-type-detection", () => ({
  detectRoomType: mockDetectRoomType,
}));

vi.mock("@/lib/api-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-quota")>();
  return {
    ...actual,
    claimDailyQuota: mockClaimDailyQuota,
    refundDailyQuota: mockRefundDailyQuota,
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
    mockRequireProjectOwnershipSafe.mockResolvedValue({ project: mockProject });
  });

  it("rejects when daily label quota is exceeded (issue #790)", async () => {
    const imageUrls = [
      "https://room1.jpg.supabase.co/storage/v1/object/public/rooms/room1.jpg",
      "https://room2.jpg.supabase.co/storage/v1/object/public/rooms/room2.jpg",
    ];

    // Simulate quota exceeded - used (20) >= limit (20). `claimDailyQuota`
    // is the atomic gate (issue #1420): it performs the cap check and the
    // increment in one conditional update, so a denial means nothing was
    // written and no refund is owed.
    mockClaimDailyQuota.mockResolvedValue({
      allowed: false,
      used: 20,
      limit: 20,
    });

    const result = await detectBatchRoomTypes(mockProject.id, imageUrls);

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("today's limit"),
    });

    expect(mockPrisma.project.findFirst).not.toHaveBeenCalled();
    // Verify no AI calls were made
    expect(mockDetectRoomType).not.toHaveBeenCalled();
    // A denied claim must not be refunded - nothing was consumed.
    expect(mockRefundDailyQuota).not.toHaveBeenCalled();
  });

  it("claims the whole batch atomically before any AI call (issue #1420)", async () => {
    const imageUrls = [
      "https://room1.jpg.supabase.co/storage/v1/object/public/rooms/room1.jpg",
      "https://room2.jpg.supabase.co/storage/v1/object/public/rooms/room2.jpg",
    ];

    mockClaimDailyQuota.mockResolvedValue({
      allowed: true,
      used: 5,
      limit: 20,
    });
    mockDetectRoomType.mockResolvedValue("Living Room");

    const result = await detectBatchRoomTypes(mockProject.id, imageUrls);

    expect(result).toEqual({
      success: true,
      roomTypes: ["Living Room", "Living Room"],
    });

    // The claim covers the whole batch size in a single call, rather than
    // an evaluate-then-record loop that could race past the cap.
    // The action resolves the cap via `resolveDailyLimit(env, DEFAULT_DAILY_LABEL_LIMIT)`
    // and with no env override set in the test env that yields the library default.
    expect(mockClaimDailyQuota).toHaveBeenCalledWith(
      "label",
      mockUser.id,
      expect.any(Number),
      imageUrls.length
    );
    expect(mockClaimDailyQuota.mock.calls[0][2]).toBeGreaterThan(0);
    expect(mockClaimDailyQuota).toHaveBeenCalledTimes(1);
    // Success path consumes nothing further and refunds nothing.
    expect(mockRefundDailyQuota).not.toHaveBeenCalled();
  });

  it("refunds the full claimed batch when detection throws (issue #1420)", async () => {
    const imageUrls = [
      "https://room1.jpg.supabase.co/storage/v1/object/public/rooms/room1.jpg",
      "https://room2.jpg.supabase.co/storage/v1/object/public/rooms/room2.jpg",
    ];

    mockClaimDailyQuota.mockResolvedValue({
      allowed: true,
      used: 5,
      limit: 20,
    });
    // `detectRoomType` itself rejects, which rejects the whole
    // `Promise.all` and lands in the outer catch.
    mockDetectRoomType.mockRejectedValue(new Error("upstream 503"));

    const result = await detectBatchRoomTypes(mockProject.id, imageUrls);

    expect(result).toEqual({
      success: false,
      error: "upstream 503",
    });

    // Every claimed unit produced no result, so all are returned.
    expect(mockRefundDailyQuota).toHaveBeenCalledWith(
      "label",
      mockUser.id,
      imageUrls.length
    );
  });

  it("refunds only the failed images' units and logs the failure (issue #1420)", async () => {
    const imageUrls = [
      "https://room1.jpg.supabase.co/storage/v1/object/public/rooms/room1.jpg",
      "https://room2.jpg.supabase.co/storage/v1/object/public/rooms/room2.jpg",
      "https://room3.jpg.supabase.co/storage/v1/object/public/rooms/room3.jpg",
    ];

    mockClaimDailyQuota.mockResolvedValue({
      allowed: true,
      used: 5,
      limit: 20,
    });
    // The middle image fails; the other two detect fine.
    mockDetectRoomType
      .mockResolvedValueOnce("Living Room")
      .mockRejectedValueOnce(new Error("upstream 503"))
      .mockResolvedValueOnce("Kitchen");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await detectBatchRoomTypes(mockProject.id, imageUrls);

    warnSpy.mockRestore();

    expect(result).toEqual({
      success: true,
      roomTypes: ["Living Room", "Other", "Kitchen"],
    });

    // Only the failed image's claimed unit is returned — the two images
    // that produced a room type keep theirs.
    expect(mockRefundDailyQuota).toHaveBeenCalledTimes(1);
    expect(mockRefundDailyQuota).toHaveBeenCalledWith("label", mockUser.id, 1);
  });

  it("logs every failed detection instead of swallowing it (issue #1420)", async () => {
    const imageUrls = [
      "https://room1.jpg.supabase.co/storage/v1/object/public/rooms/room1.jpg",
      "https://room2.jpg.supabase.co/storage/v1/object/public/rooms/room2.jpg",
    ];

    mockClaimDailyQuota.mockResolvedValue({
      allowed: true,
      used: 5,
      limit: 20,
    });
    mockDetectRoomType.mockRejectedValue(new Error("upstream 503"));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await detectBatchRoomTypes(mockProject.id, imageUrls);

    const warnEvents = warnSpy.mock.calls.map((call) => {
      try {
        return JSON.parse(String(call[0])).event;
      } catch {
        return null;
      }
    });
    const errorEvents = errorSpy.mock.calls.map((call) => {
      try {
        return JSON.parse(String(call[0])).event;
      } catch {
        return null;
      }
    });

    warnSpy.mockRestore();
    errorSpy.mockRestore();

    // One log line per failed image, plus a batch-level line for the
    // all-failed batch — a total upstream outage is never silent.
    expect(warnEvents).toEqual([
      "batch_room_type_detection_failed",
      "batch_room_type_detection_failed",
    ]);
    expect(errorEvents).toContain("batch_room_type_detection_failed_batch");
  });

  it("refuses before claiming quota when the caller does not own the project", async () => {
    const imageUrls = [
      "https://room1.jpg.supabase.co/storage/v1/object/public/rooms/room1.jpg",
    ];

    mockRequireProjectOwnershipSafe.mockResolvedValue(null);
    mockClaimDailyQuota.mockResolvedValue({
      allowed: true,
      used: 0,
      limit: 20,
    });

    const result = await detectBatchRoomTypes("someone-elses-project", imageUrls);

    expect(result).toEqual({
      success: false,
      error: "Project not found",
    });

    // A non-owner must neither consume nor refund the caller's quota.
    expect(mockClaimDailyQuota).not.toHaveBeenCalled();
    expect(mockRefundDailyQuota).not.toHaveBeenCalled();
    expect(mockDetectRoomType).not.toHaveBeenCalled();
  });
});

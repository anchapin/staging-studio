import { beforeEach, describe, expect, it, vi } from "vitest";

// Issue #1136: a Prisma record-write failure after a successful durable
// upload must surface as `retryable`, never as `completed`/`persisted:
// true` (which desyncs the client and re-uploads on every poll).

const mockPrisma = vi.hoisted(() => ({
  inpaintRequest: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
const mockSupabase = vi.hoisted(() => {
  const storage = {
    from: () => ({
      upload: vi.fn(async () => ({ data: { path: "after-req-1.png" }, error: null })),
      getPublicUrl: () => ({
        data: {
          publicUrl:
            "https://example.supabase.co/storage/v1/object/public/staging-images/after-req-1.png",
        },
      }),
    }),
  };
  return { storage };
});
const mockClient = vi.hoisted(() => ({
  status: vi.fn(),
  result: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/supabase", () => ({ createSupabaseRequestClient: async () => mockSupabase }));
vi.mock("@/lib/inference", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inference")>();
  return {
    ...actual,
    getInferenceClient: async () => mockClient,
  };
});

import { pollFalStatus } from "@/lib/inpaint-status";

const REQUEST_ID = "req-1";
const ROW = {
  id: REQUEST_ID,
  status: "IN_QUEUE",
  resultUrl: null,
  updatedAt: new Date("2026-10-12T00:00:00Z"),
  room: { project: { userId: "cuser12345678901234567890" } },
};

describe("pollFalStatus record-write failure (issue #1136)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, blob: async () => new Blob(["png-bytes"]) }))
    );
    mockPrisma.inpaintRequest.findUnique.mockResolvedValue(ROW);
    mockClient.status.mockResolvedValue({ status: "COMPLETED" });
    mockClient.result.mockResolvedValue({
      data: { images: [{ url: "https://fal.media/flux/tmp/result.png" }] },
    });
  });

  it("returns retryable (not completed) when the record write fails", async () => {
    mockPrisma.inpaintRequest.update.mockRejectedValue(new Error("connection refused"));

    const result = await pollFalStatus(REQUEST_ID);

    expect(mockPrisma.inpaintRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: REQUEST_ID },
        data: { status: "COMPLETED", resultUrl: expect.any(String) },
      })
    );
    expect(result.status).toBe("retryable");
    expect(result.persisted).toBe(false);
    expect(result.imageUrl).toBeNull();
  });

  it("returns retryable when the write fails on a PERSISTENCE_FAILED retry", async () => {
    // Fresh updatedAt stays inside the PERSISTENCE_GIVE_UP_MS window
    // (2 min), so the branch reaches the persistence path.
    mockPrisma.inpaintRequest.findUnique.mockResolvedValue({
      ...ROW,
      status: "PERSISTENCE_FAILED",
      updatedAt: new Date(),
    });
    mockPrisma.inpaintRequest.update.mockRejectedValue(new Error("connection refused"));

    const result = await pollFalStatus(REQUEST_ID);

    expect(result.status).toBe("retryable");
    expect(result.persisted).toBe(false);
    expect(result.imageUrl).toBeNull();
  });

  it("returns completed/persisted when the record write lands", async () => {
    mockPrisma.inpaintRequest.update.mockResolvedValue(ROW);

    const result = await pollFalStatus(REQUEST_ID);

    expect(result.status).toBe("completed");
    expect(result.persisted).toBe(true);
    expect(result.imageUrl).toBe(
      "https://example.supabase.co/storage/v1/object/public/staging-images/after-req-1.png"
    );
  });
});

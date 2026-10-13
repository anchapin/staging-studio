import { beforeEach, describe, expect, it, vi } from "vitest";

// Issue #1121: persistInpaintImage's failure paths and the PERSISTENCE_FAILED
// re-entry branch were untested. Four distinct failure branches inside
// persistInpaintImage must each return { persisted: false, imageUrl: null }
// with a correlatable console.error event (#717), and the PERSISTENCE_FAILED
// retry path in pollInpaintStatus must call client.result exactly once for a
// legacy row (no memoized URL) and persist on success.
//
// Already pinned elsewhere (not re-covered here): the :655 PERSISTENCE_FAILED
// failure-write payload (tests/inpaint-status-route.test.ts), the attempt cap
// / backoff gate / memoized-URL skip (tests/inpaint-persistence-economics.test.ts),
// and the record-write failure contract (tests/inpaint-status-record-failure.test.ts).

const mockPrisma = vi.hoisted(() => ({
  inpaintRequest: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
const mockSupabase = vi.hoisted(() => {
  const upload = vi.fn();
  const getPublicUrl = vi.fn();
  const storage = {
    from: () => ({ upload, getPublicUrl }),
  };
  return { storage, upload, getPublicUrl };
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

import { persistInpaintImage, pollInpaintStatus } from "@/lib/inpaint-status";

const REQUEST_ID = "req-1";
const FAL_URL = "https://fal-cdn.example/result.png";
const PUBLIC_URL =
  "https://example.supabase.co/storage/v1/object/public/staging-images/after-req-1.png";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, blob: async () => new Blob(["png-bytes"]) }))
  );
  mockSupabase.upload.mockResolvedValue({ data: { path: `after-${REQUEST_ID}.png` }, error: null });
  mockSupabase.getPublicUrl.mockReturnValue({ data: { publicUrl: PUBLIC_URL } });
  mockPrisma.inpaintRequest.update.mockResolvedValue({});
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("persistInpaintImage failure branches (issue #1121)", () => {
  it("non-ok fal CDN response: no upload, inpaint_persist_failed, persisted false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, statusText: "Forbidden" }))
    );

    const out = await persistInpaintImage(FAL_URL, REQUEST_ID);

    expect(out).toEqual({ persisted: false, imageUrl: null });
    expect(mockSupabase.upload).not.toHaveBeenCalled();
    expect(mockSupabase.getPublicUrl).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("inpaint_persist_failed"),
      expect.any(Error)
    );
  });

  it("supabase upload error: inpaint_upload_failed, persisted false, no public URL lookup", async () => {
    mockSupabase.upload.mockResolvedValue({
      data: null,
      error: { message: "bucket unavailable" },
    });

    const out = await persistInpaintImage(FAL_URL, REQUEST_ID);

    expect(out).toEqual({ persisted: false, imageUrl: null });
    expect(mockSupabase.upload).toHaveBeenCalledWith(
      `after-${REQUEST_ID}.png`,
      expect.any(Blob),
      expect.objectContaining({ contentType: "image/png", upsert: true })
    );
    expect(mockSupabase.getPublicUrl).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("inpaint_upload_failed"),
      "bucket unavailable"
    );
  });

  it("upload resolving without data counts as a failure too", async () => {
    mockSupabase.upload.mockResolvedValue({ data: null, error: null });

    const out = await persistInpaintImage(FAL_URL, REQUEST_ID);

    expect(out).toEqual({ persisted: false, imageUrl: null });
    expect(mockSupabase.getPublicUrl).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("inpaint_upload_failed"),
      "upload resolved without data"
    );
  });

  it("missing publicUrl: upload landed but inpaint_public_url_missing, persisted false", async () => {
    mockSupabase.getPublicUrl.mockReturnValue({ data: { publicUrl: null } });

    const out = await persistInpaintImage(FAL_URL, REQUEST_ID);

    expect(out).toEqual({ persisted: false, imageUrl: null });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("inpaint_public_url_missing")
    );
  });

  it("fetch rejecting (network down): catch-all inpaint_persist_failed, persisted false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));

    const out = await persistInpaintImage(FAL_URL, REQUEST_ID);

    expect(out).toEqual({ persisted: false, imageUrl: null });
    expect(mockSupabase.upload).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("inpaint_persist_failed"),
      expect.any(Error)
    );
  });

  it("happy path still returns the public URL", async () => {
    const out = await persistInpaintImage(FAL_URL, REQUEST_ID);
    expect(out).toEqual({ persisted: true, imageUrl: PUBLIC_URL });
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("PERSISTENCE_FAILED re-entry persists on success (issue #1121)", () => {
  it("legacy row with no memoized URL calls client.result once and completes", async () => {
    mockPrisma.inpaintRequest.findUnique.mockResolvedValue({
      id: REQUEST_ID,
      status: "PERSISTENCE_FAILED",
      resultUrl: null,
      falResultUrl: null, // legacy row: the memo column predates this upload
      persistenceAttempts: 1,
      lastPersistenceAttemptAt: new Date(Date.now() - 60_000), // outside backoff (1s)
      updatedAt: new Date(Date.now() - 10_000), // inside the give-up window
      room: { project: { userId: "cuser12345678901234567890" } },
    });
    mockClient.result.mockResolvedValue({ data: { images: [{ url: FAL_URL }] } });

    const out = await pollInpaintStatus(REQUEST_ID);

    // Exactly one provider result fetch, then durable persistence.
    expect(mockClient.result).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ status: "completed", imageUrl: PUBLIC_URL, persisted: true });
    expect(mockPrisma.inpaintRequest.update).toHaveBeenCalledWith({
      where: { id: REQUEST_ID },
      data: { status: "COMPLETED", resultUrl: PUBLIC_URL },
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});

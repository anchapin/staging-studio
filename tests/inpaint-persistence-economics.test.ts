import { beforeEach, describe, expect, it, vi } from "vitest";

// Issue #1143: a PERSISTENCE_FAILED inpaint must not re-download the fal
// result and re-upload it byte-identical on every poll. Three guards:
// memoized falResultUrl (no client.result re-fetch), an exponential
// backoff gate (no provider calls inside the window), and an attempt
// cap that terminates provider traffic while keeping the row
// PERSISTENCE_FAILED for later manual recovery (#687).

const mockPrisma = vi.hoisted(() => ({
  inpaintRequest: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
const mockSupabase = vi.hoisted(() => {
  const upload = vi.fn(async () => ({ data: { path: "after-req-1.png" }, error: null }));
  const storage = {
    from: () => ({
      upload,
      getPublicUrl: () => ({
        data: {
          publicUrl:
            "https://example.supabase.co/storage/v1/object/public/staging-images/after-req-1.png",
        },
      }),
    }),
  };
  return { storage, upload };
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

import {
  MAX_PERSISTENCE_ATTEMPTS,
  persistenceBackoffMs,
  pollInpaintStatus,
} from "@/lib/inpaint-status";

const REQUEST_ID = "req-1";
const FAL_URL = "https://fal-cdn.example/result.png";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    status: "PERSISTENCE_FAILED",
    resultUrl: null,
    falResultUrl: FAL_URL,
    persistenceAttempts: 0,
    lastPersistenceAttemptAt: null,
    updatedAt: new Date(Date.now() - 10_000), // recent: outside the #687 give-up window
    room: { project: { userId: "cuser12345678901234567890" } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, blob: async () => new Blob(["png-bytes"]) }))
  );
  mockPrisma.inpaintRequest.update.mockResolvedValue({});
  mockClient.result.mockResolvedValue({
    data: { images: [{ url: FAL_URL }] },
  });
});

describe("persistenceBackoffMs", () => {
  it("doubles from 1s and caps at 30s", () => {
    expect(persistenceBackoffMs(0)).toBe(1000);
    expect(persistenceBackoffMs(1)).toBe(1000);
    expect(persistenceBackoffMs(2)).toBe(2000);
    expect(persistenceBackoffMs(3)).toBe(4000);
    expect(persistenceBackoffMs(4)).toBe(8000);
    expect(persistenceBackoffMs(5)).toBe(16000);
    expect(persistenceBackoffMs(6)).toBe(30000);
    expect(persistenceBackoffMs(99)).toBe(30000);
  });
});

describe("pollInpaintStatus PERSISTENCE_FAILED economics (issue #1143)", () => {
  it("skips client.result entirely when falResultUrl is memoized", async () => {
    mockPrisma.inpaintRequest.findUnique.mockResolvedValue(row());
    const out = await pollInpaintStatus(REQUEST_ID);
    expect(mockClient.result).not.toHaveBeenCalled();
    expect(out.status).toBe("completed");
    expect(out.imageUrl).toContain("example.supabase.co/storage/v1/object/public/staging-images");
    expect(out.imageUrl).not.toBe(FAL_URL); // persisted URL, not the fal CDN one
    expect(out.persisted).toBe(true);
  });

  it("returns retryable without provider calls while inside the backoff window", async () => {
    const attempts = 2; // backoff 2000ms
    mockPrisma.inpaintRequest.findUnique.mockResolvedValue(
      row({
        persistenceAttempts: attempts,
        lastPersistenceAttemptAt: new Date(Date.now() - 500),
      })
    );
    const out = await pollInpaintStatus(REQUEST_ID);
    expect(out.status).toBe("retryable");
    expect(mockClient.result).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mockSupabase.upload).not.toHaveBeenCalled();
    expect(mockPrisma.inpaintRequest.update).not.toHaveBeenCalled();
  });

  it("terminates provider traffic at the attempt cap, row still PERSISTENCE_FAILED", async () => {
    mockPrisma.inpaintRequest.findUnique.mockResolvedValue(
      row({
        persistenceAttempts: MAX_PERSISTENCE_ATTEMPTS,
        lastPersistenceAttemptAt: new Date(Date.now() - 60_000),
      })
    );
    const out = await pollInpaintStatus(REQUEST_ID);
    expect(out.status).toBe("completed");
    expect(out.persisted).toBe(false);
    expect(out.imageUrl).toBe(FAL_URL);
    expect(mockClient.result).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mockPrisma.inpaintRequest.update).not.toHaveBeenCalled();
  });

  it("fetches and memoizes the result URL for a legacy row with no stored URL", async () => {
    mockPrisma.inpaintRequest.findUnique.mockResolvedValue(row({ falResultUrl: null }));
    await pollInpaintStatus(REQUEST_ID);
    expect(mockClient.result).toHaveBeenCalledTimes(1);
    const memoWrite = mockPrisma.inpaintRequest.update.mock.calls.find(
      ([args]) => args.data?.falResultUrl === FAL_URL
    );
    expect(memoWrite).toBeTruthy();
  });

  it("records the attempt before the upload try", async () => {
    mockPrisma.inpaintRequest.findUnique.mockResolvedValue(row());
    await pollInpaintStatus(REQUEST_ID);
    const attemptWrite = mockPrisma.inpaintRequest.update.mock.calls.find(
      ([args]) => args.data?.persistenceAttempts?.increment === 1
    );
    expect(attemptWrite).toBeTruthy();
    expect(attemptWrite![0].data.lastPersistenceAttemptAt).toBeInstanceOf(Date);
  });
});

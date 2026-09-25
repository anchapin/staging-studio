import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/setup/route";
import { GET } from "@/app/api/setup/check/route";
import { prisma } from "@/lib/prisma";

const { mockCreateServerClient } = vi.hoisted(() => ({
  mockCreateServerClient: vi.fn(),
}));

const mockCreateSupabaseRequestClient = vi.hoisted(() => vi.fn());

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    getAll: vi.fn(() => []),
  })),
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: mockCreateSupabaseRequestClient,
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    setupRateLimit: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  return {
    prisma: {
      $transaction: vi.fn().mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
      ...prisma,
    },
  };
});

const mockUser = {
  id: "user-123",
  email: "test@example.com",
  firmName: "Test Firm",
  ownerName: "Test Owner",
  createdAt: new Date(),
  updatedAt: new Date(),
};

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

function mockSupabaseGetUser(user: object | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
  };
}

function buildRequest(body?: unknown): NextRequest {
  return {
    cookies: {
      getAll: vi.fn().mockReturnValue([]),
      set: vi.fn(),
    },
    headers: {
      get: vi.fn().mockReturnValue(null),
    },
    json: body ? () => Promise.resolve(body) : undefined,
  } as unknown as NextRequest;
}

describe("POST /api/setup", () => {
  beforeEach(() => {
    mockCreateServerClient.mockReset();
    vi.mocked(prisma.user.create).mockReset();
    vi.mocked(prisma.setupRateLimit.upsert).mockReset();
    vi.mocked(prisma.setupRateLimit.upsert).mockResolvedValue({
      id: "rate-limit-id",
      ipHash: "test-ip",
      attemptCount: 1,
      windowStart: new Date(),
      lockedUntil: null,
      updatedAt: new Date(),
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateServerClient.mockReturnValue(mockSupabaseGetUser(null));

    const req = buildRequest({ firmName: "Test Firm", ownerName: "Test Owner", email: "test@example.com" });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 400 when required fields are missing", async () => {
    mockCreateServerClient.mockReturnValue(mockSupabaseGetUser({ id: "user-123" }));

    const req = buildRequest({ firmName: "Test Firm" });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Missing required fields");
  });

  it("returns 200 when user is created successfully", async () => {
    mockCreateServerClient.mockReturnValue(mockSupabaseGetUser({ id: "user-123" }));
    vi.mocked(prisma.user.create).mockResolvedValue(mockUser as never);

    const req = buildRequest({ firmName: "Test Firm", ownerName: "Test Owner", email: "test@example.com" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.user.email).toBe("test@example.com");
  });

  it("returns 500 when database operation fails", async () => {
    mockCreateServerClient.mockReturnValue(mockSupabaseGetUser({ id: "user-123" }));
    vi.mocked(prisma.user.create).mockRejectedValue(new Error("Database error"));

    const req = buildRequest({ firmName: "Test Firm", ownerName: "Test Owner", email: "test@example.com" });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Internal server error");
  });
});

describe("GET /api/setup/check", () => {
  beforeEach(() => {
    mockCreateServerClient.mockReset();
    mockCreateSupabaseRequestClient.mockReset();
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.setupRateLimit.upsert).mockReset();
    vi.mocked(prisma.setupRateLimit.upsert).mockResolvedValue({
      id: "rate-limit-id",
      ipHash: "test-ip",
      attemptCount: 1,
      windowStart: new Date(),
      lockedUntil: null,
      updatedAt: new Date(),
    });
  });

  it("returns 200 with setupComplete=false when unauthenticated", async () => {
    mockCreateServerClient.mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const req = buildRequest();
    const res = await GET(req);
    const json = await res.json();

    // Route returns 200 to prevent user enumeration
    expect(res.status).toBe(200);
    expect(json.setupComplete).toBe(false);
  });

  it("returns 200 with setupComplete=false when authenticated but no user row exists", async () => {
    mockCreateServerClient.mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-123", email: "test@example.com" } }, error: null }) },
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);

    const req = buildRequest();
    const res = await GET(req);
    const json = await res.json();

    // Route returns 200 to prevent user enumeration
    expect(res.status).toBe(200);
    expect(json.setupComplete).toBe(false);
  });

  it("returns 200 with setupComplete=true when authenticated and user row exists", async () => {
    mockCreateServerClient.mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-123", email: "test@example.com" } }, error: null }) },
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

    const req = buildRequest();
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.setupComplete).toBe(true);
  });
});

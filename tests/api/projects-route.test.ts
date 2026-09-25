/**
 * Projects CRUD Route Tests
 *
 * Tests for GET /api/projects (list) and POST /api/projects (create).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { GET, POST } from "@/app/api/projects/route";

// Mock user and project data
const MOCK_USER_ID = "user-123";
const MOCK_USER = { id: MOCK_USER_ID, email: "test@example.com" };
const MOCK_SUPABASE_USER = { id: "auth-user-1", email: "test@example.com" };

const MOCK_PROJECTS = [
  {
    id: "project-1",
    propertyAddress: "123 Main St",
    clientName: "John Doe",
    stagingAesthetic: "modern",
    createdAt: new Date(),
    rooms: [],
  },
  {
    id: "project-2",
    propertyAddress: "456 Oak Ave",
    clientName: "Jane Smith",
    stagingAesthetic: "traditional",
    createdAt: new Date(),
    rooms: [],
  },
];

// Mock factories - using vi.hoisted to ensure proper module mock order
const mockGetAuthedPrismaUser = vi.hoisted(() => vi.fn());
const mockProjectFindMany = vi.hoisted(() => vi.fn());
const mockProjectCreate = vi.hoisted(() => vi.fn());
const mockUserFindUnique = vi.hoisted(() => vi.fn());
const mockCreateSupabaseRequestClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: mockGetAuthedPrismaUser,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findMany: mockProjectFindMany,
      create: mockProjectCreate,
    },
    user: {
      findUnique: mockUserFindUnique,
    },
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    getAll: vi.fn(() => []),
  })),
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: mockCreateSupabaseRequestClient,
}));

// Default supabase client mock - returns authenticated user
const defaultSupabaseClient = () => ({
  auth: {
    getUser: vi.fn(() => Promise.resolve({ data: { user: MOCK_SUPABASE_USER }, error: null })),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: authenticated user for both auth methods
  mockGetAuthedPrismaUser.mockResolvedValue(MOCK_USER);
  mockCreateSupabaseRequestClient.mockImplementation(defaultSupabaseClient);
  // Default: prisma mocks
  mockProjectFindMany.mockResolvedValue(MOCK_PROJECTS);
  mockProjectCreate.mockImplementation(async (args: any) => ({
    ...MOCK_PROJECTS[0],
    ...args.data,
    rooms: [],
  }));
  mockUserFindUnique.mockResolvedValue(MOCK_USER);
});

// ============================================================
// GET /api/projects
// ============================================================

describe("GET /api/projects", () => {
  it("returns 401 when user is not authenticated", async () => {
    mockGetAuthedPrismaUser.mockResolvedValue(null);

    const request = new Request("http://localhost/api/projects", { method: "GET" });
    const response = await GET(request as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.message).toBe("You must be logged in to access this resource.");
  });

  it("returns projects list for authenticated user", async () => {
    mockGetAuthedPrismaUser.mockResolvedValue(MOCK_USER);
    mockProjectFindMany.mockResolvedValue(MOCK_PROJECTS);

    const request = new Request("http://localhost/api/projects", { method: "GET" });
    const response = await GET(request as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].propertyAddress).toBe("123 Main St");
    expect(body[1].propertyAddress).toBe("456 Oak Ave");
    expect(mockProjectFindMany).toHaveBeenCalledWith({
      where: { userId: MOCK_USER_ID },
      select: {
        id: true,
        propertyAddress: true,
        clientName: true,
        stagingAesthetic: true,
        createdAt: true,
        rooms: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("returns empty list when user has no projects", async () => {
    mockGetAuthedPrismaUser.mockResolvedValue(MOCK_USER);
    mockProjectFindMany.mockResolvedValue([]);

    const request = new Request("http://localhost/api/projects", { method: "GET" });
    const response = await GET(request as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(0);
  });
});

// ============================================================
// POST /api/projects
// ============================================================

describe("POST /api/projects", () => {
  const validBody = {
    propertyAddress: "123 Main St",
    clientName: "John Doe",
    targetBuyer: "young-professional",
    stagingAesthetic: "modern",
    rooms: [],
  };

  it("returns 401 when user is not authenticated", async () => {
    // Override supabase mock to return null user
    mockCreateSupabaseRequestClient.mockReturnValueOnce({
      auth: {
        getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
      },
    });

    const request = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    const response = await POST(request as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.message).toBe("You must be logged in to create a project.");
  });

  it("creates a project with valid body", async () => {
    mockGetAuthedPrismaUser.mockResolvedValue(MOCK_USER);
    mockUserFindUnique.mockResolvedValue(MOCK_USER);
    mockProjectCreate.mockResolvedValue({ ...MOCK_PROJECTS[0], rooms: [] });

    const request = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    const response = await POST(request as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.propertyAddress).toBe("123 Main St");
    expect(mockProjectCreate).toHaveBeenCalledWith({
      data: {
        userId: MOCK_USER_ID,
        propertyAddress: "123 Main St",
        clientName: "John Doe",
        targetBuyer: "young-professional",
        stagingAesthetic: "modern",
        stagingPackage: null,
        buyerDemographics: undefined,
        rooms: { create: [] },
      },
      include: { rooms: true },
    });
  });

  it("returns 400 when required fields are missing", async () => {
    mockGetAuthedPrismaUser.mockResolvedValue(MOCK_USER);

    const request = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const response = await POST(request as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("missing-required-fields");
    expect(body.error.message).toBe(
      "propertyAddress, clientName, targetBuyer, and stagingAesthetic are required."
    );
  });

  it("returns 400 when propertyAddress is missing", async () => {
    mockGetAuthedPrismaUser.mockResolvedValue(MOCK_USER);

    const request = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientName: "John Doe",
        targetBuyer: "young-professional",
        stagingAesthetic: "modern",
      }),
    });
    const response = await POST(request as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("missing-required-fields");
  });

  it("returns 404 when user is not found in database", async () => {
    mockGetAuthedPrismaUser.mockResolvedValue(MOCK_USER);
    mockUserFindUnique.mockResolvedValue(null);

    const request = new Request("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    const response = await POST(request as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("user-not-found");
    expect(body.error.message).toBe("User not found in database.");
  });
});

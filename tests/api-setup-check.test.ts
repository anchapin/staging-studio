/**
 * Tests for /api/setup/check endpoint user enumeration fix (#914)
 *
 * Verifies that the endpoint always returns 200 OK with a consistent
 * body structure regardless of whether the user account exists, using
 * `setupComplete` field instead of `exists` to prevent user enumeration.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { NextRequest } from "next/server";

import { GET } from "@/app/api/setup/check/route";
import { prisma } from "@/lib/prisma";

// Mock @supabase/ssr to control the auth user
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(),
    },
  })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

const mockPrismaUserFindUnique = prisma.user.findUnique as unknown as Mock;

function buildSupabaseClient(user: unknown) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
  };
}

async function callCheckRoute(): Promise<Response> {
  const request = new Request("http://localhost/api/setup/check", {
    method: "GET",
  });
  return GET(request as unknown as NextRequest);
}

describe("GET /api/setup/check — user enumeration prevention (#914)", () => {
  let createServerClientMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    const { createServerClient } = await import("@supabase/ssr");
    createServerClientMock = createServerClient as ReturnType<typeof vi.fn>;
    // Default: unauthenticated
    createServerClientMock.mockReturnValue(buildSupabaseClient(null));
  });

  it("returns 200 with setupComplete: false for unauthenticated requests", async () => {
    createServerClientMock.mockReturnValue(buildSupabaseClient(null));

    const response = await callCheckRoute();
    const body = await response.json();

    // Unauthenticated should return 200 OK with setupComplete: false
    // (not 401, to prevent user enumeration)
    expect(response.status).toBe(200);
    expect(body).toEqual({ setupComplete: false });
    // No user lookup should be made for unauthenticated requests
    expect(mockPrismaUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns 200 with setupComplete: false for authenticated but no Prisma User row", async () => {
    createServerClientMock.mockReturnValue(
      buildSupabaseClient({ id: "user-123", email: "test@example.com" })
    );
    mockPrismaUserFindUnique.mockResolvedValue(null);

    const response = await callCheckRoute();
    const body = await response.json();

    // Authenticated but no user row should return 200 OK with setupComplete: false
    // (not 404, to prevent user enumeration)
    expect(response.status).toBe(200);
    expect(body).toEqual({ setupComplete: false });
  });

  it("returns 200 with setupComplete: true for fully set up user", async () => {
    createServerClientMock.mockReturnValue(
      buildSupabaseClient({ id: "user-123", email: "test@example.com" })
    );
    mockPrismaUserFindUnique.mockResolvedValue({
      id: "user-123",
      email: "test@example.com",
      firmName: "Test Firm",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await callCheckRoute();
    const body = await response.json();

    // Fully set up user should return 200 OK with setupComplete: true
    expect(response.status).toBe(200);
    expect(body).toEqual({ setupComplete: true });
  });

  it("returns 200 with setupComplete: false on database error", async () => {
    createServerClientMock.mockReturnValue(
      buildSupabaseClient({ id: "user-123", email: "test@example.com" })
    );
    mockPrismaUserFindUnique.mockRejectedValue(new Error("DB connection failed"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await callCheckRoute();
    const body = await response.json();

    // Error should still return 200 OK with setupComplete: false
    // (not 500, to prevent user enumeration)
    expect(response.status).toBe(200);
    expect(body).toEqual({ setupComplete: false });
    consoleErrorSpy.mockRestore();
  });

  it("does not expose whether account exists via 'exists' field", async () => {
    createServerClientMock.mockReturnValue(
      buildSupabaseClient({ id: "user-123", email: "test@example.com" })
    );
    mockPrismaUserFindUnique.mockResolvedValue(null);

    const response = await callCheckRoute();
    const body = await response.json();

    // Response should NOT contain 'exists' field
    expect(body).not.toHaveProperty("exists");
    expect(body).toHaveProperty("setupComplete");
    expect(body.setupComplete).toBe(false);
  });

  it("always returns consistent status code 200 regardless of user state", async () => {
    // Test all three states and verify they all return 200
    const states = [
      { user: null, userRow: null, description: "unauthenticated" },
      { user: { id: "user-1", email: "a@b.com" }, userRow: null, description: "authenticated no user row" },
      {
        user: { id: "user-1", email: "a@b.com" },
        userRow: { id: "user-1", email: "a@b.com", firmName: "Firm", createdAt: new Date(), updatedAt: new Date() },
        description: "fully set up",
      },
    ];

    for (const { user, userRow, description } of states) {
      createServerClientMock.mockReturnValue(buildSupabaseClient(user));
      mockPrismaUserFindUnique.mockResolvedValue(userRow);

      const response = await callCheckRoute();
      expect(response.status, `Expected 200 for ${description}`).toBe(200);
    }
  });
});

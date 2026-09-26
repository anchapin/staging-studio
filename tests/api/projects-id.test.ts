/**
 * Projects [id] Route — GET /api/projects/[id]
 *
 * Coverage:
 * - 401 unauthenticated (no valid session)
 * - 404 project not found or user does not own it
 * - 200 with correct response shape when authorized
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "@/app/api/projects/[id]/route";
import { getAuthedPrismaUser, requireProjectOwnershipThrow } from "@/lib/api-auth";
import { ApiError } from "@/lib/api-error-handler";
import { API_ERROR_PROJECT_NOT_FOUND } from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_PROJECT_ID = "cproj12345678901234567890";

const mockUser = {
  id: MOCK_USER_ID,
  email: "test@example.com",
  firmName: "Test Firm",
  ownerName: "Test Owner",
  logoUrl: null,
  psychologyPageContent: null,
  signoffContent: null,
  darkMode: false,
  createdAt: new Date(),
};

const mockProject = {
  id: MOCK_PROJECT_ID,
  userId: MOCK_USER_ID,
  propertyAddress: "123 Main St",
  clientName: "Jane Buyer",
  targetBuyer: "young professional couple",
  stagingAesthetic: "Organic Modern Luxury",
  roiSalesPricePremium: "+8–12%",
  roiTransactionVelocity: "24 Days",
  roiInvestmentTier: "$45,000",
  stagingPackage: "premium",
  stagingDirectives: "make it feel warm and inviting",
  buyerDemographics: { buyerType: "young professional", designPreferences: ["modern", "minimal"] },
  clientSignature: null,
  clientSignatureStatus: "Pending",
  clientSignatureTimestamp: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  user: {
    firmName: "Test Firm",
    ownerName: "Test Owner",
    psychologyPageContent: null,
    signoffContent: null,
  },
  rooms: [],
};

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
  requireProjectOwnershipThrow: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
  },
}));

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("GET /api/projects/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 401 — no session
  // -------------------------------------------------------------------------

  it("returns 401 when there is no valid session", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const res = await GET(
      new Request("http://localhost/api/projects/" + MOCK_PROJECT_ID) as unknown as NextRequest,
      { params: Promise.resolve({ id: MOCK_PROJECT_ID }) }
    );

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe("unauthorized");
  });

  // -------------------------------------------------------------------------
  // 404 — project not found or user does not own it
  // -------------------------------------------------------------------------

  it("returns 404 when the project does not exist", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(requireProjectOwnershipThrow).mockRejectedValue(
      new ApiError({ code: API_ERROR_PROJECT_NOT_FOUND, message: "Project not found", status: 404 })
    );

    const res = await GET(
      new Request("http://localhost/api/projects/" + MOCK_PROJECT_ID) as unknown as NextRequest,
      { params: Promise.resolve({ id: MOCK_PROJECT_ID }) }
    );

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("project-not-found");
  });

  it("returns 404 when the project exists but user does not own it", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(requireProjectOwnershipThrow).mockRejectedValue(
      new ApiError({ code: API_ERROR_PROJECT_NOT_FOUND, message: "Project not found", status: 404 })
    );

    const res = await GET(
      new Request("http://localhost/api/projects/some-other-project-id") as unknown as NextRequest,
      { params: Promise.resolve({ id: "some-other-project-id" }) }
    );

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("project-not-found");
  });

  // -------------------------------------------------------------------------
  // 200 — authorized, project exists
  // -------------------------------------------------------------------------

  it("returns 200 with the correct response shape when authorized", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(requireProjectOwnershipThrow).mockResolvedValue(mockProject);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(mockProject);

    const res = await GET(
      new Request("http://localhost/api/projects/" + MOCK_PROJECT_ID) as unknown as NextRequest,
      { params: Promise.resolve({ id: MOCK_PROJECT_ID }) }
    );

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json).toMatchObject({
      id: MOCK_PROJECT_ID,
      propertyAddress: "123 Main St",
      clientName: "Jane Buyer",
      targetBuyer: "young professional couple",
      stagingAesthetic: "Organic Modern Luxury",
    });

    expect(json.user).toMatchObject({
      firmName: "Test Firm",
      ownerName: "Test Owner",
    });

    expect(Array.isArray(json.rooms)).toBe(true);
  });
});

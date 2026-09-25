import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectOwnershipError } from "@/lib/api-error-handler";
import { API_ERROR_PROJECT_OWNERSHIP_DENIED } from "@/lib/api-errors";

// We test requireProjectOwnership by mocking prisma
// The module under test:
import { requireProjectOwnership } from "@/lib/api-auth";

// ---------------------------------------------------------------------------
// Mock prisma
// ---------------------------------------------------------------------------

// vi.hoisted ensures the mock factory is evaluated at call time, not at hoisting time
const mockFindUnique = vi.hoisted(() => vi.fn<() => Promise<{ id: string } | null>>());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: mockFindUnique,
    },
  },
}));

beforeEach(() => {
  mockFindUnique.mockReset();
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OWNER_USER_ID = "user-owner-123";
const OTHER_USER_ID = "user-other-456";
const PROJECT_ID = "project-abc-789";

// ---------------------------------------------------------------------------
// requireProjectOwnership
// ---------------------------------------------------------------------------

describe("requireProjectOwnership", () => {
  it("returns void when the project exists and belongs to the user", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: PROJECT_ID });

    await expect(
      requireProjectOwnership(PROJECT_ID, OWNER_USER_ID)
    ).resolves.toBeUndefined();

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, userId: OWNER_USER_ID },
      select: { id: true },
    });
  });

  it("throws ProjectOwnershipError when the project exists but belongs to a different user", async () => {
    // Simulate: project exists but userId doesn't match → findUnique returns null
    mockFindUnique.mockResolvedValueOnce(null);

    await expect(
      requireProjectOwnership(PROJECT_ID, OTHER_USER_ID)
    ).rejects.toThrow(ProjectOwnershipError);

    await expect(
      requireProjectOwnership(PROJECT_ID, OTHER_USER_ID)
    ).rejects.toMatchObject({
      code: API_ERROR_PROJECT_OWNERSHIP_DENIED,
      status: 403,
      name: "ProjectOwnershipError",
    });
  });

  it("throws ProjectOwnershipError when the project does not exist", async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    await expect(
      requireProjectOwnership("non-existent-project", OWNER_USER_ID)
    ).rejects.toThrow(ProjectOwnershipError);

    await expect(
      requireProjectOwnership("non-existent-project", OWNER_USER_ID)
    ).rejects.toMatchObject({
      code: API_ERROR_PROJECT_OWNERSHIP_DENIED,
      status: 403,
      details: { projectId: "non-existent-project" },
    });
  });
});

// ---------------------------------------------------------------------------
// ProjectOwnershipError
// ---------------------------------------------------------------------------

describe("ProjectOwnershipError", () => {
  it("has the correct error code and HTTP status", () => {
    const error = new ProjectOwnershipError(PROJECT_ID);

    expect(error.code).toBe(API_ERROR_PROJECT_OWNERSHIP_DENIED);
    expect(error.status).toBe(403);
    expect(error.name).toBe("ProjectOwnershipError");
    expect(error.message).toContain(PROJECT_ID);
  });

  it("extends Error and is an instance of Error", () => {
    const error = new ProjectOwnershipError(PROJECT_ID);
    expect(error instanceof Error).toBe(true);
    expect(error instanceof ProjectOwnershipError).toBe(true);
  });

  it("includes projectId in details", () => {
    const error = new ProjectOwnershipError("my-project-id");
    expect(error.details).toEqual({ projectId: "my-project-id" });
  });
});

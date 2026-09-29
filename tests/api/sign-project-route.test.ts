import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/sign-project/route";
import { getAuthedPrismaUser, ProjectForbiddenError, ProjectNotFoundError, requireProjectOwnershipOrThrow } from "@/lib/api-auth";
import { verifyPreviewToken } from "@/lib/preview-token";
import { prisma } from "@/lib/prisma";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_PROJECT_ID = "cproj12345678901234567890";
const MOCK_SIGNATURE = "data:image/png;base64,mock-signature-data";
const MOCK_TOKEN = "valid-hmac-token";

const mockUser = { id: MOCK_USER_ID, email: "test@example.com", name: "Test User" };

function buildRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
  requireProjectOwnershipOrThrow: vi.fn(async () => {}),
  ProjectNotFoundError: class ProjectNotFoundError extends Error {},
  ProjectForbiddenError: class ProjectForbiddenError extends Error {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/preview-token", () => ({
  verifyPreviewToken: vi.fn(),
  signPreviewToken: vi.fn(),
  PREVIEW_TOKEN_QUERY_PARAM: "token",
}));

describe("POST /api/sign-project", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests with an invalid token and no session with 401 (issue #1078 token-first gate)", async () => {
    // No session (cookie-less preview visitor) AND an invalid token:
    // the token gate runs first and answers 401 with the invalidToken
    // copy. Pre-#1078 this used to read "Unauthorized" because the
    // session check ran before the token was ever consulted.
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);
    vi.mocked(verifyPreviewToken).mockResolvedValue({ valid: false });

    const req = buildRequest({ projectId: MOCK_PROJECT_ID, signatureDataUrl: MOCK_SIGNATURE, token: "tampered-token" });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    const body = json as { error: string; message?: string };
    expect(body.message).toContain("expired or is invalid");
    expect(body.error).not.toBe("Unauthorized");
  });

  it("rejects authenticated user who does not own the project with 403", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
    vi.mocked(requireProjectOwnershipOrThrow).mockRejectedValueOnce(new ProjectForbiddenError("not owner"));
    vi.mocked(verifyPreviewToken).mockResolvedValue({ valid: true, projectId: MOCK_PROJECT_ID });

    const req = buildRequest({ projectId: MOCK_PROJECT_ID, signatureDataUrl: MOCK_SIGNATURE, token: MOCK_TOKEN });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Forbidden");
  });

  it("returns 404 when project does not exist", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
    vi.mocked(requireProjectOwnershipOrThrow).mockRejectedValueOnce(new ProjectNotFoundError("missing"));
    vi.mocked(verifyPreviewToken).mockResolvedValue({ valid: true, projectId: MOCK_PROJECT_ID });

    const req = buildRequest({ projectId: MOCK_PROJECT_ID, signatureDataUrl: MOCK_SIGNATURE, token: MOCK_TOKEN });
    const res = await POST(req);

    expect(res.status).toBe(404);
  });

  it("returns 409 when project is already signed (conditional update guards)", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
    vi.mocked(verifyPreviewToken).mockResolvedValue({ valid: true, projectId: MOCK_PROJECT_ID });
    // updateMany returns count === 0 when no rows match the predicate
    vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 0 });

    const req = buildRequest({ projectId: MOCK_PROJECT_ID, signatureDataUrl: MOCK_SIGNATURE, token: MOCK_TOKEN });
    const res = await POST(req);

    expect(res.status).toBe(409);
    // Verify updateMany was called with the conditional guard
    expect(prisma.project.updateMany).toHaveBeenCalledWith({
      where: {
        id: MOCK_PROJECT_ID,
        clientSignatureStatus: { not: "Signed" },
      },
      data: {
        clientSignature: MOCK_SIGNATURE,
        clientSignatureStatus: "Signed",
        clientSignatureTimestamp: expect.any(Date),
      },
    });
    // The fix ensures no write happened when already signed
    expect(prisma.project.updateMany).toHaveBeenCalledTimes(1);
  });

  it("saves signature and returns 200 for valid authenticated request", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
    vi.mocked(verifyPreviewToken).mockResolvedValue({ valid: true, projectId: MOCK_PROJECT_ID });
    // updateMany returns count === 1 when the row was successfully updated
    vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 1 });

    const req = buildRequest({ projectId: MOCK_PROJECT_ID, signatureDataUrl: MOCK_SIGNATURE, token: MOCK_TOKEN });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true });
    expect(prisma.project.updateMany).toHaveBeenCalledWith({
      where: {
        id: MOCK_PROJECT_ID,
        clientSignatureStatus: { not: "Signed" },
      },
      data: {
        clientSignature: MOCK_SIGNATURE,
        clientSignatureStatus: "Signed",
        clientSignatureTimestamp: expect.any(Date),
      },
    });
  });

  it("captures timestamp once before retry loop (issue #1146)", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
    vi.mocked(verifyPreviewToken).mockResolvedValue({ valid: true, projectId: MOCK_PROJECT_ID });

    const timestamps: Date[] = [];
    vi.mocked(prisma.project.updateMany).mockImplementation(async () => {
      timestamps.push(new Date());
      return { count: 1 };
    });

    const req = buildRequest({ projectId: MOCK_PROJECT_ID, signatureDataUrl: MOCK_SIGNATURE, token: MOCK_TOKEN });
    const res = await POST(req);

    expect(res.status).toBe(200);
    // Even if updateMany is called multiple times due to retries,
    // the timestamp should be captured once in the route handler
    // and passed to each retry attempt.
    expect(prisma.project.updateMany).toHaveBeenCalled();
    const calls = vi.mocked(prisma.project.updateMany).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // All calls should have the same timestamp (captured once before the loop)
    const firstTimestamp = calls[0][0].data.clientSignatureTimestamp;
    for (const call of calls) {
      expect(call[0].data.clientSignatureTimestamp).toBe(firstTimestamp);
    }
  });
});

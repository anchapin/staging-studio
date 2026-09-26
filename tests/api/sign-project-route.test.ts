import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { POST } from "@/app/api/sign-project/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { verifyPreviewToken } from "@/lib/preview-token";
import { prisma } from "@/lib/prisma";
import { withCors } from "@/lib/cors";

const mockWithCors = vi.fn((r: NextResponse) => r);

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_OTHER_USER_ID = "cuser22345678901234567890";
const MOCK_PROJECT_ID = "cproj12345678901234567890";
const MOCK_SIGNATURE = "data:image/png;base64,mock-signature-data";
const MOCK_TOKEN = "valid-hmac-token";

const mockUser = { id: MOCK_USER_ID, email: "test@example.com", name: "Test User" };
const mockRequireProjectOwnership = vi.hoisted(() => vi.fn());

function buildRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
  requireProjectOwnership: mockRequireProjectOwnership,
}));

vi.mock("@/lib/cors", () => ({
  withCors: mockWithCors,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      update: vi.fn(),
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
    mockRequireProjectOwnership.mockResolvedValue({ ok: true, projectId: MOCK_PROJECT_ID });
    mockWithCors.mockImplementation((r: NextResponse) => r);
  });

  it("rejects unauthenticated requests with 401", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const req = buildRequest({ projectId: MOCK_PROJECT_ID, signatureDataUrl: MOCK_SIGNATURE, token: MOCK_TOKEN });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect((json as { error: string }).error).toBe("Unauthorized");
  });

  it("rejects authenticated user who does not own the project with 403", async () => {
    mockRequireProjectOwnership.mockResolvedValue({
      ok: false,
      reason: "forbidden",
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });

    const req = buildRequest({ projectId: MOCK_PROJECT_ID, signatureDataUrl: MOCK_SIGNATURE, token: MOCK_TOKEN });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Forbidden");
  });

  it("returns 404 when project does not exist", async () => {
    mockRequireProjectOwnership.mockResolvedValue({
      ok: false,
      reason: "not_found",
      response: NextResponse.json({ error: "Project not found" }, { status: 404 }),
    });

    const req = buildRequest({ projectId: MOCK_PROJECT_ID, signatureDataUrl: MOCK_SIGNATURE, token: MOCK_TOKEN });
    const res = await POST(req);

    expect(res.status).toBe(404);
  });

  it("returns 409 when project is already signed", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
    mockRequireProjectOwnership.mockResolvedValue({ ok: true, projectId: MOCK_PROJECT_ID });
    vi.mocked(prisma.project.findUnique).mockImplementation(
      ((args: Record<string, unknown>) => {
        const select = args?.select as Record<string, unknown> | undefined;
        if (select?.clientSignatureStatus) {
          return Promise.resolve({ clientSignatureStatus: "Signed" } as any);
        }
        return Promise.resolve({ id: MOCK_PROJECT_ID, userId: MOCK_USER_ID } as any);
      }) as any,
    );

    const req = buildRequest({ projectId: MOCK_PROJECT_ID, signatureDataUrl: MOCK_SIGNATURE, token: MOCK_TOKEN });
    const res = await POST(req);

    expect(res.status).toBe(409);
  });

  it("saves signature and returns 200 for valid authenticated request", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
    vi.mocked(verifyPreviewToken).mockResolvedValue({ valid: true, projectId: MOCK_PROJECT_ID });
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: MOCK_PROJECT_ID,
      userId: MOCK_USER_ID,
      clientSignatureStatus: "Pending",
    } as never);
    vi.mocked(prisma.project.update).mockResolvedValue({
      id: MOCK_PROJECT_ID,
      userId: MOCK_USER_ID,
      clientSignatureStatus: "Signed",
      clientSignature: MOCK_SIGNATURE,
      clientSignatureTimestamp: new Date(),
    } as never);

    const req = buildRequest({ projectId: MOCK_PROJECT_ID, signatureDataUrl: MOCK_SIGNATURE, token: MOCK_TOKEN });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: MOCK_PROJECT_ID },
      data: {
        clientSignature: MOCK_SIGNATURE,
        clientSignatureStatus: "Signed",
        clientSignatureTimestamp: expect.any(Date),
      },
    });
  });
});

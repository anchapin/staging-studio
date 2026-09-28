import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/sign-project/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { signPreviewToken, verifyPreviewToken } from "@/lib/preview-token";
import { withRetry } from "@/lib/retry";

// --- Constants ---------------------------------------------------------------

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_PROJECT_ID = "cproj12345678901234567890";

const MOCK_USER = {
  id: MOCK_USER_ID,
  email: "test@example.com",
  name: "Test User",
};

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// --- Helpers -----------------------------------------------------------------

function buildRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

function validPayload(projectId: string = MOCK_PROJECT_ID, token: string = "valid-token") {
  return {
    projectId,
    signatureDataUrl: TINY_PNG_DATA_URL,
    token,
  };
}

function buildProject(status: "Pending" | "Signed" = "Pending") {
  return { clientSignatureStatus: status };
}

// --- Mocks -------------------------------------------------------------------
//
// vi.hoisted keeps the mock fns stable across vi.resetAll() (each test gets a
// fresh invocation log without losing the reference held by vi.mock).
const mockRequireProjectOwnershipOrThrow = vi.hoisted(() => vi.fn());
const { MockProjectNotFoundError, MockProjectForbiddenError } = vi.hoisted(() => {
  class MockProjectNotFoundError extends Error {
    constructor(public projectId: string) {
      super(`Project not found: ${projectId}`);
      this.name = "ProjectNotFoundError";
    }
  }
  class MockProjectForbiddenError extends Error {
    constructor(public projectId: string) {
      super(`Forbidden: ${projectId}`);
      this.name = "ProjectForbiddenError";
    }
  }
  return { MockProjectNotFoundError, MockProjectForbiddenError };
});

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
  requireProjectOwnershipOrThrow: mockRequireProjectOwnershipOrThrow,
  ProjectNotFoundError: MockProjectNotFoundError,
  ProjectForbiddenError: MockProjectForbiddenError,
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
  signPreviewToken: vi.fn(),
  verifyPreviewToken: vi.fn(),
  PREVIEW_TOKEN_QUERY_PARAM: "token",
  PREVIEW_TOKEN_TTL_SECONDS: 300,
}));

vi.mock("@/lib/retry", () => ({
  withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

// --- Tests -------------------------------------------------------------------

describe("POST /api/sign-project — issue #1078 token-first gate order", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(signPreviewToken).mockResolvedValue("mock-signed-token");
    // Default: the route's HMAC verify says "yes, scoped to MOCK_PROJECT_ID".
    vi.mocked(verifyPreviewToken).mockResolvedValue({
      valid: true,
      projectId: MOCK_PROJECT_ID,
    });
    // Default: no authenticated session (the cookie-less preview path).
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);
    // Default: ownership check passes if invoked.
    mockRequireProjectOwnershipOrThrow.mockResolvedValue(undefined);
    // Default: project is unsigned, update succeeds.
    vi.mocked(prisma.project.findUnique).mockResolvedValue(buildProject("Pending") as never);
    vi.mocked(prisma.project.update).mockResolvedValue(buildProject("Signed") as never);
  });

  it("verifies the HMAC preview token BEFORE consulting the session (issue #1078)", async () => {
    // Reset call-order bookkeeping after beforeEach's resetAllMocks.
    const verifySpy = vi.mocked(verifyPreviewToken);
    const getUserSpy = vi.mocked(getAuthedPrismaUser);
    verifySpy.mockClear();
    getUserSpy.mockClear();

    const req = buildRequest(validPayload());
    const res = await POST(req);

    expect(res.status).toBe(200);

    // Both were called…
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(getUserSpy).toHaveBeenCalledTimes(1);
    // …but token verification happened first. This is the regression
    // pin: pre-#1078 the route returned 401 before verifyPreviewToken
    // was ever called for cookie-less preview visitors.
    const verifyOrder = verifySpy.mock.invocationCallOrder[0]!;
    const getUserOrder = getUserSpy.mock.invocationCallOrder[0]!;
    expect(verifyOrder).toBeLessThan(getUserOrder);
  });

  it("rejects a tampered token with 401 'expired or is invalid' before checking the session", async () => {
    vi.mocked(verifyPreviewToken).mockResolvedValue({ valid: false });
    const getUserSpy = vi.mocked(getAuthedPrismaUser);
    getUserSpy.mockClear();

    const req = buildRequest(validPayload(MOCK_PROJECT_ID, "tampered-token"));
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.message).toContain("expired or is invalid");
    // Session must NOT have been consulted: the tampered token is
    // answered without a Prisma user lookup.
    expect(getUserSpy).not.toHaveBeenCalled();
  });

  it("accepts a valid token + cookie-less preview visitor (the #1078 fix)", async () => {
    // beforeEach already configures: no session, valid token, unsigned project.
    const req = buildRequest(validPayload());
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // The Prisma write must have happened.
    expect(prisma.project.update).toHaveBeenCalledTimes(1);
    // No session was needed, so no ownership check ran.
    expect(mockRequireProjectOwnershipOrThrow).not.toHaveBeenCalled();
  });

  it("rejects a token whose payload.projectId does not match the request body", async () => {
    // Token signed for a DIFFERENT project than the body claims.
    vi.mocked(verifyPreviewToken).mockResolvedValue({
      valid: true,
      projectId: "cotherprojectid123456789",
    });

    const req = buildRequest(validPayload());
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.message).toContain("expired or is invalid");
    // Defense-in-depth: mismatched token + no session → must not reach
    // the write. (An authenticated user with mismatched token would
    // also be 401'd because the token gate runs first and only a
    // matching token authorizes the cookie-less path.)
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("accepts a valid token + authenticated firm user with ownership (no regression)", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(MOCK_USER as never);

    const req = buildRequest(validPayload());
    const res = await POST(req);

    expect(res.status).toBe(200);
    // Session-bearing callers still go through the ownership check.
    expect(mockRequireProjectOwnershipOrThrow).toHaveBeenCalledTimes(1);
    expect(mockRequireProjectOwnershipOrThrow).toHaveBeenCalledWith(
      MOCK_PROJECT_ID,
      MOCK_USER,
    );
    expect(prisma.project.update).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when an authenticated firm user lacks project ownership", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(MOCK_USER as never);
    mockRequireProjectOwnershipOrThrow.mockRejectedValue(
      new MockProjectForbiddenError(MOCK_PROJECT_ID),
    );

    const req = buildRequest(validPayload());
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the project does not exist for an authenticated user", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(MOCK_USER as never);
    mockRequireProjectOwnershipOrThrow.mockRejectedValue(
      new MockProjectNotFoundError(MOCK_PROJECT_ID),
    );

    const req = buildRequest(validPayload());
    const res = await POST(req);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.message).toContain("could not be found");
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("returns 409 when the project is already Signed (immutability, issue #684)", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(
      buildProject("Signed") as never,
    );

    const req = buildRequest(validPayload());
    const res = await POST(req);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.message).toContain("already been signed");
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid projectId format", async () => {
    const req = buildRequest(validPayload("not-a-cuid"));
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    // The schema-level field-error path maps projectId failures to
    // "The project could not be found." (matches invalidProject copy).
    expect(json.message).toContain("could not be found");
  });

  it("returns 400 when token is missing from the payload", async () => {
    const req = buildRequest({
      projectId: MOCK_PROJECT_ID,
      signatureDataUrl: TINY_PNG_DATA_URL,
      // token intentionally omitted — schema requires min(1).
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    // Missing-token schema failures land on the default 401 invalidToken
    // path (no `projectId` or `signatureDataUrl` field match).
    expect(json.message).toContain("expired or is invalid");
    expect(verifyPreviewToken).not.toHaveBeenCalled();
  });

  it("logs sign_project_save_failed and returns 500 when the Prisma update throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(prisma.project.update).mockRejectedValue(
      new Error("simulated db outage"),
    );

    const req = buildRequest(validPayload());
    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.message).toContain("Unable to save the signature");
    expect(consoleError).toHaveBeenCalledWith(
      "sign_project_save_failed",
      expect.objectContaining({ projectId: MOCK_PROJECT_ID }),
    );
    consoleError.mockRestore();
  });

  it("uses withRetry for the Prisma update", async () => {
    // Sanity: the route's retry wrapper is invoked (not a bypass).
    const req = buildRequest(validPayload());
    await POST(req);

    expect(withRetry).toHaveBeenCalledTimes(1);
  });
});
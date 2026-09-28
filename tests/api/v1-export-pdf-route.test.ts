import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// Use vi.hoisted so the mock is fresh for each test run and doesn't retain
// state from the full suite run
const { buildBrowserlessPdfUrl, buildBrowserlessPdfBody, resolveBrowserlessPdfUrl, fetchBrowserlessPdfWithCircuitBreaker } = vi.hoisted(() => {
  return {
    buildBrowserlessPdfUrl: vi.fn(() => "https://chrome.browserless.io/pdf"),
    buildBrowserlessPdfBody: vi.fn((url: string) => ({
      url,
      gotoOptions: { waitUntil: "networkidle0" as const },
      options: {
        printBackground: true,
        format: "Letter",
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      },
    })),
    // Issue #1084 follow-up: the v1 route resolves its endpoint through the
    // hermetic-gated resolver, not the raw constant builder.
    resolveBrowserlessPdfUrl: vi.fn(() => "https://chrome.browserless.io/pdf"),
    fetchBrowserlessPdfWithCircuitBreaker: vi.fn(),
  };
});

const mockGetAuthedPrismaUser = vi.hoisted(() => vi.fn());
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
const mockProjectFindUnique = vi.hoisted(() => vi.fn());
const mockDailyApiUsageUpsert = vi.hoisted(() => vi.fn());
const mockDailyApiUsageFindUnique = vi.hoisted(() => vi.fn());
const mockSignPreviewToken = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: mockGetAuthedPrismaUser,
  requireProjectOwnershipOrThrow: mockRequireProjectOwnershipOrThrow,
  ProjectNotFoundError: MockProjectNotFoundError,
  ProjectForbiddenError: MockProjectForbiddenError,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: mockProjectFindUnique },
    dailyApiUsage: { upsert: mockDailyApiUsageUpsert, findUnique: mockDailyApiUsageFindUnique },
  },
}));

vi.mock("@/lib/preview-token", () => ({
  signPreviewToken: mockSignPreviewToken,
}));

vi.mock("@/lib/browserless", () => ({
  buildBrowserlessPdfUrl,
  buildBrowserlessPdfBody,
  resolveBrowserlessPdfUrl,
  BROWSERLESS_TIMEOUT_MS: 60_000,
  E2E_HERMETIC_ENV_VAR: "E2E_HERMETIC",
  E2E_BROWSERLESS_PDF_URL_ENV_VAR: "E2E_BROWSERLESS_PDF_URL",
  fetchBrowserlessPdfWithCircuitBreaker,
}));

// We need to import after mocking
import { GET } from "@/app/api/v1/export-pdf/route";

const USER_ID = "user-1";
// Exactly 25 chars: c + 24 lowercase alphanumerics (matches PROJECT_ID_PATTERN /^c[a-z0-9]{24}$/)
const PROJECT_ID = "c1234567890abcdef12345678";

const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_APP_URL: "http://localhost",
      BROWSERLESS_API_KEY: "test-browserless-key",
      NODE_ENV: "development",
    };
    mockGetAuthedPrismaUser.mockResolvedValue({ id: USER_ID });
    mockRequireProjectOwnershipOrThrow.mockResolvedValue({ ok: true, projectId: PROJECT_ID });
    mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, userId: USER_ID });
    mockDailyApiUsageUpsert.mockResolvedValue({});
    mockDailyApiUsageFindUnique.mockResolvedValue({ count: 0 });
    mockSignPreviewToken.mockResolvedValue("test-preview-token");

    // Default: the resolver hands back the real endpoint. The hermetic-seam
    // tests below override it; every other test keeps production behavior.
    resolveBrowserlessPdfUrl.mockReset().mockImplementation(() => "https://chrome.browserless.io/pdf");
    buildBrowserlessPdfUrl.mockClear();

    // Default: successful PDF generation
    fetchBrowserlessPdfWithCircuitBreaker.mockReset().mockImplementation((url: string | URL | Request) => {
    if (String(url).includes("chrome.browserless.io")) {
      return Promise.resolve(
        new Response(Buffer.from("%PDF-1.4 fake pdf content"), {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        })
      );
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
});

function callExportRoute(projectId?: string): Promise<Response> {
  const url = projectId
    ? `http://localhost/api/v1/export-pdf?projectId=${projectId}`
    : "http://localhost/api/v1/export-pdf";
  const request = new Request(url, {
    method: "GET",
  });
  return GET(request as unknown as NextRequest);
}

describe("GET /api/v1/export-pdf — projectId validation", () => {
  it("returns 400 when projectId is missing", async () => {
    const response = await callExportRoute();
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid-request");
  });

  it("returns 400 when projectId format is invalid (not a CUID)", async () => {
    const response = await callExportRoute("not-a-cuid");
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid-request");
  });

  it("returns 400 when projectId is too short", async () => {
    const response = await callExportRoute("c123");
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid-request");
  });

  it("accepts a valid CUID-formatted projectId and returns a PDF", async () => {
    const response = await callExportRoute(PROJECT_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
  });
});

describe("GET /api/v1/export-pdf — auth", () => {
  it("returns 401 when user is not authenticated", async () => {
    mockGetAuthedPrismaUser.mockResolvedValue(null);

    const response = await callExportRoute(PROJECT_ID);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("unauthorized");
  });
});

describe("GET /api/v1/export-pdf — ownership", () => {
  it("returns 404 when project does not exist", async () => {
    mockRequireProjectOwnershipOrThrow.mockRejectedValue(new MockProjectNotFoundError(PROJECT_ID));

    const response = await callExportRoute(PROJECT_ID);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("project-not-found");
  });

  it("returns 403 when project belongs to a different user", async () => {
    mockRequireProjectOwnershipOrThrow.mockRejectedValue(new MockProjectForbiddenError(PROJECT_ID));

    const response = await callExportRoute(PROJECT_ID);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
  });
});

describe("GET /api/v1/export-pdf — response headers", () => {
  it("includes API-Version header in response", async () => {
    const response = await callExportRoute(PROJECT_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("API-Version")).toBe("v1");
  });
});

/**
 * Issue #1084 follow-up: the v1 route used to call `buildBrowserlessPdfUrl()`
 * directly, so it had no hermetic seam and no e2e spec could drive the real
 * handler. These pin that it now resolves through `resolveBrowserlessPdfUrl`
 * — the same gate the unversioned `/api/export-pdf` route uses.
 */
describe("GET /api/v1/export-pdf — hermetic Browserless endpoint seam", () => {
  const MOCK_ENDPOINT = "http://127.0.0.1:8899/pdf";

  function mockPdfResponseForAnyUrl() {
    fetchBrowserlessPdfWithCircuitBreaker.mockReset().mockImplementation(() =>
      Promise.resolve(
        new Response(Buffer.from("%PDF-1.4 fake pdf content"), {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        })
      )
    );
  }

  it("resolves the endpoint through the hermetic-gated resolver, not the raw builder", async () => {
    mockPdfResponseForAnyUrl();
    resolveBrowserlessPdfUrl.mockReturnValue(MOCK_ENDPOINT);

    const response = await callExportRoute(PROJECT_ID);

    expect(response.status).toBe(200);
    expect(resolveBrowserlessPdfUrl).toHaveBeenCalledTimes(1);
    // Regression guard: buildBrowserlessPdfUrl is precisely what the seam
    // replaced. Reverting to it fails here rather than silently re-closing
    // the seam and pointing a future e2e spec at the paid API.
    expect(buildBrowserlessPdfUrl).not.toHaveBeenCalled();
  });

  it("forwards both hermetic env vars to the resolver at call time", async () => {
    mockPdfResponseForAnyUrl();
    process.env.E2E_HERMETIC = "1";
    process.env.E2E_BROWSERLESS_PDF_URL = MOCK_ENDPOINT;

    await callExportRoute(PROJECT_ID);

    expect(resolveBrowserlessPdfUrl).toHaveBeenCalledWith("1", MOCK_ENDPOINT);
  });

  it("passes the resolved endpoint through as the outbound fetch target", async () => {
    mockPdfResponseForAnyUrl();
    resolveBrowserlessPdfUrl.mockReturnValue(MOCK_ENDPOINT);

    const response = await callExportRoute(PROJECT_ID);

    expect(response.status).toBe(200);
    expect(fetchBrowserlessPdfWithCircuitBreaker).toHaveBeenCalledTimes(1);
    expect(String(fetchBrowserlessPdfWithCircuitBreaker.mock.calls[0][0])).toBe(MOCK_ENDPOINT);
  });

  it("keeps the credential contract: the API key stays in the Authorization header, never the URL", async () => {
    mockPdfResponseForAnyUrl();
    resolveBrowserlessPdfUrl.mockReturnValue(MOCK_ENDPOINT);

    await callExportRoute(PROJECT_ID);

    const [url, init] = fetchBrowserlessPdfWithCircuitBreaker.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("test-browserless-key");
    expect(init.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("test-browserless-key:").toString("base64")}`,
    });
  });
});

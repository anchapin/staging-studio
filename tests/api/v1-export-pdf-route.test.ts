import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-error-handler";
import type { NextRequest } from "next/server";

// Use vi.hoisted so the mock is fresh for each test run and doesn't retain
// state from the full suite run
const { buildBrowserlessPdfUrl, buildBrowserlessPdfBody, fetchBrowserlessPdfWithCircuitBreaker } = vi.hoisted(() => {
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
    fetchBrowserlessPdfWithCircuitBreaker: vi.fn(),
  };
});

const mockGetAuthedPrismaUser = vi.hoisted(() => vi.fn());
const mockProjectFindUnique = vi.hoisted(() => vi.fn());
const mockDailyApiUsageUpsert = vi.hoisted(() => vi.fn());
const mockDailyApiUsageFindUnique = vi.hoisted(() => vi.fn());
const mockSignPreviewToken = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: mockGetAuthedPrismaUser,
  requireProjectOwnership: vi.fn(),
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
  BROWSERLESS_TIMEOUT_MS: 60_000,
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
  mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, userId: USER_ID });
  mockDailyApiUsageUpsert.mockResolvedValue({});
  mockDailyApiUsageFindUnique.mockResolvedValue({ count: 0 });
  mockSignPreviewToken.mockResolvedValue("test-preview-token");

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
    mockProjectFindUnique.mockResolvedValue(null);

    const response = await callExportRoute(PROJECT_ID);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("project-not-found");
  });

  it("returns 404 when project belongs to a different user", async () => {
    mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, userId: "other-user" });

    const response = await callExportRoute(PROJECT_ID);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("project-not-found");
  });
});

describe("GET /api/v1/export-pdf — response headers", () => {
  it("includes API-Version header in response", async () => {
    const response = await callExportRoute(PROJECT_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("API-Version")).toBe("v1");
  });
});

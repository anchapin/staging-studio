import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { NextRequest } from "next/server";

import { POST } from "@/app/api/export-pdf/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

// Use vi.hoisted so the mock is fresh for each test run and doesn't retain
// state from the full suite run (avoids global.fetch pollution from sibling test files)
const {
  buildBrowserlessPdfUrl,
  buildBrowserlessPdfBody,
  fetchBrowserlessPdfWithCircuitBreaker,
  requireProjectOwnership,
  ProjectNotFoundError,
  ProjectForbiddenError,
} = vi.hoisted(() => {
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
    requireProjectOwnership: vi.fn(),
    ProjectNotFoundError: MockProjectNotFoundError,
    ProjectForbiddenError: MockProjectForbiddenError,
  };
});

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
  requireProjectOwnership,
  ProjectNotFoundError,
  ProjectForbiddenError,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    dailyApiUsage: { upsert: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/browserless", () => ({
  buildBrowserlessPdfUrl,
  buildBrowserlessPdfBody,
  BROWSERLESS_TIMEOUT_MS: 60_000,
  fetchBrowserlessPdfWithCircuitBreaker,
}));

const authedUser = getAuthedPrismaUser as unknown as Mock;
const projectFindUnique = prisma.project.findUnique as unknown as Mock;
const dailyApiUsageUpsert = prisma.dailyApiUsage.upsert as unknown as Mock;
const dailyApiUsageFindUnique = prisma.dailyApiUsage.findUnique as unknown as Mock;

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
    };
    authedUser.mockResolvedValue({ id: USER_ID });
    projectFindUnique.mockResolvedValue({ id: PROJECT_ID, userId: USER_ID });
    requireProjectOwnership.mockResolvedValue({ ok: true, projectId: PROJECT_ID });
    dailyApiUsageFindUnique.mockResolvedValue({ count: 0 });
  dailyApiUsageUpsert.mockResolvedValue({ count: 1 });
  // Reset hoisted mock and delegate to global.fetch so per-test overrides work
  vi.mocked(fetchBrowserlessPdfWithCircuitBreaker).mockReset().mockImplementation(
    (url: string, opts?: RequestInit) => global.fetch(url, opts) as Promise<Response>,
  );
});

function validBody() {
  return { projectId: PROJECT_ID };
}

async function callExportRoute(body: unknown): Promise<Response> {
  const request = new Request("http://localhost/api/export-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request as unknown as NextRequest);
}

beforeEach(() => {
  vi.resetAllMocks();
  authedUser.mockResolvedValue({ id: USER_ID });
  projectFindUnique.mockResolvedValue({ id: PROJECT_ID, userId: USER_ID });
  dailyApiUsageFindUnique.mockResolvedValue({ count: 0 });
  dailyApiUsageUpsert.mockResolvedValue({ count: 1 });
  vi.mocked(fetchBrowserlessPdfWithCircuitBreaker).mockReset().mockImplementation(
    (url: string, opts?: RequestInit) => global.fetch(url, opts) as Promise<Response>,
  );
});

describe("POST /api/export-pdf — projectId validation", () => {
  it("returns 400 when projectId is missing", async () => {
    const response = await callExportRoute({});
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid projectId");
  });

  it("returns 400 when projectId is not a string", async () => {
    const response = await callExportRoute({ projectId: 123 });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid projectId");
  });

  it("returns 400 when projectId format is invalid (not a CUID)", async () => {
    const response = await callExportRoute({ projectId: "not-a-cuid" });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid projectId");
  });

  it("returns 400 when projectId is too short", async () => {
    const response = await callExportRoute({ projectId: "c123" });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid projectId");
  });

  it("returns 400 when projectId contains uppercase letters", async () => {
    const response = await callExportRoute({ projectId: "C1234567890ABCDEF12345678" });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid projectId");
  });

  it("accepts a valid CUID-formatted projectId and returns a PDF", async () => {
    const pdfContent = Buffer.from("%PDF-1.4 fake pdf content");
    vi.mocked(fetchBrowserlessPdfWithCircuitBreaker).mockResolvedValue(
      new Response(pdfContent, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      })
    );

    const response = await callExportRoute(validBody());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");

    const returnedBody = await response.arrayBuffer();
    expect(Buffer.from(returnedBody)).toEqual(pdfContent);
  });
});

describe("POST /api/export-pdf — auth", () => {
  it("returns 401 when user is not authenticated", async () => {
    authedUser.mockResolvedValue(null);

    const response = await callExportRoute(validBody());
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });
});

describe("POST /api/export-pdf — quota", () => {
  it("returns 429 when daily export limit is exceeded", async () => {
    dailyApiUsageFindUnique.mockResolvedValue({ count: 20 });

    const response = await callExportRoute(validBody());
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe("Daily limit reached");
    expect(body.retryable).toBe(true);
  });
});

describe("POST /api/export-pdf — ownership", () => {
  it("returns 404 when project does not exist", async () => {
    requireProjectOwnership.mockRejectedValue(new ProjectNotFoundError(PROJECT_ID));

    const response = await callExportRoute(validBody());
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Project not found");
  });

  it("returns 403 when project belongs to a different user", async () => {
    requireProjectOwnership.mockRejectedValue(new ProjectForbiddenError(PROJECT_ID));

    const response = await callExportRoute(validBody());
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
  });
});

describe("POST /api/export-pdf — PDF generation", () => {
  it("returns 502 when Browserless returns non-PDF content", async () => {
    vi.mocked(fetchBrowserlessPdfWithCircuitBreaker).mockResolvedValue(
      new Response("not a pdf", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })
    );

    const response = await callExportRoute(validBody());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe("PDF generation failed");
  });

  it("returns Browserless error status when Browserless returns an error", async () => {
    const mockResponse = new Response("Browserless error", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
    vi.mocked(fetchBrowserlessPdfWithCircuitBreaker).mockResolvedValue(mockResponse);

    const response = await callExportRoute(validBody());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("PDF generation failed");
    expect(body.retryable).toBe(true);
  });

  it("returns the PDF buffer with correct content-type on success", async () => {
    const pdfContent = Buffer.from("%PDF-1.4 test pdf content");
    vi.mocked(fetchBrowserlessPdfWithCircuitBreaker).mockResolvedValue(
      new Response(pdfContent, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      })
    );

    const response = await callExportRoute(validBody());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");

    const body = await response.arrayBuffer();
    expect(Buffer.from(body)).toEqual(pdfContent);
  });

  it("builds the correct Browserless URL and signed preview URL", async () => {
    const pdfContent = Buffer.from("%PDF-1.4 test pdf content");
    vi.mocked(fetchBrowserlessPdfWithCircuitBreaker).mockResolvedValue(
      new Response(pdfContent, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      })
    );

    await callExportRoute(validBody());

    expect(fetchBrowserlessPdfWithCircuitBreaker).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(fetchBrowserlessPdfWithCircuitBreaker).mock.calls[0];
    expect(callArgs).toBeDefined();
    const [url] = callArgs as [string, RequestInit];
    expect(url).toBe("https://chrome.browserless.io/pdf");
  });
});

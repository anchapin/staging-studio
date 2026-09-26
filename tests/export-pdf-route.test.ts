import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/export-pdf/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { signPreviewToken } from "@/lib/preview-token";
import {
  getDailyUsage,
  recordDailyUsage,
  evaluateDailyQuota,
} from "@/lib/api-quota";


const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_PROJECT_ID = "cproj12345678901234567890";
const MOCK_API_KEY = "test-browserless-key";

const mockUser = { id: MOCK_USER_ID, email: "test@example.com", name: "Test User" };
const mockRequireProjectOwnership = vi.hoisted(() => vi.fn());

function buildRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

// Use vi.hoisted so the mock is fresh for each test run and doesn't retain
// state from the full suite run (avoids fetchBrowserlessPdfWithCircuitBreaker
// pollution from api/export-pdf-route.test.ts)
const mockFetchBrowserless = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
  requireProjectOwnership: mockRequireProjectOwnership,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/preview-token", () => ({
  signPreviewToken: vi.fn(),
  PREVIEW_TOKEN_QUERY_PARAM: "token",
}));

vi.mock("@/lib/browserless", () => ({
  buildBrowserlessPdfUrl: vi.fn(() => "https://browserless.example.com/pdf"),
  buildBrowserlessPdfBody: vi.fn(() => ({ url: "https://example.com/preview" })),
  BROWSERLESS_TIMEOUT_MS: 60000,
  fetchBrowserlessPdfWithCircuitBreaker: mockFetchBrowserless,
}));

vi.mock("@/lib/api-quota", () => ({
  getDailyUsage: vi.fn(),
  recordDailyUsage: vi.fn(),
  evaluateDailyQuota: vi.fn(),
  DEFAULT_DAILY_EXPORT_LIMIT: 20,
  resolveDailyLimit: vi.fn(() => 20),
  dailyQuotaExceededPayload: vi.fn(() => ({
    error: "Daily limit reached",
    message: "Please try again tomorrow.",
    retryable: true,
    used: 20,
    limit: 20,
    resetsAt: new Date(Date.now() + 86400000).toISOString(),
  })),
  DAILY_LIMIT_ENV_VAR: { export: "DAILY_EXPORT_LIMIT" },
}));

describe("POST /api/export-pdf", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset the hoisted mock and give it a default implementation that delegates to
    // global.fetch (so per-test global.fetch assignments work). Tests that need a
    // different fetch behaviour override mockFetchBrowserless.mockResolvedValue themselves.
    vi.mocked(mockFetchBrowserless).mockReset().mockImplementation(
      (url: string, opts?: RequestInit) => global.fetch(url, opts) as Promise<Response>,
    );
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
    mockRequireProjectOwnership.mockResolvedValue({ ok: true, projectId: MOCK_PROJECT_ID });
    vi.mocked(getDailyUsage).mockResolvedValue(0);
    vi.mocked(evaluateDailyQuota).mockReturnValue({
      allowed: true,
      used: 0,
      limit: 20,
      remaining: 20,
    });
    vi.mocked(signPreviewToken).mockResolvedValue("mock-signed-token");
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: MOCK_PROJECT_ID,
      userId: MOCK_USER_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
      propertyAddress: "123 Test St",
      clientName: "Test Client",
      targetBuyer: "Family",
      stagingAesthetic: "Modern",
      roiSalesPricePremium: null,
      roiTransactionVelocity: null,
      roiInvestmentTier: null,
      stagingDirectives: null,
      buyerDemographics: null,
      stagingPackage: null,
      clientSignature: null,
      clientSignatureStatus: null,
      clientSignatureTimestamp: null,
    } as never);
    process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
    process.env.BROWSERLESS_API_KEY = MOCK_API_KEY;
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const req = buildRequest({ projectId: MOCK_PROJECT_ID });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 429 when daily export quota exceeded", async () => {
    vi.mocked(evaluateDailyQuota).mockReturnValue({
      allowed: false,
      used: 20,
      limit: 20,
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    });

    const req = buildRequest({ projectId: MOCK_PROJECT_ID });
    const res = await POST(req);

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe("Daily limit reached");
    expect(json.retryable).toBe(true);
  });

  it("returns 400 for invalid projectId format", async () => {
    const req = buildRequest({ projectId: "invalid-id" });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid projectId");
  });

  it("returns 400 when projectId is missing", async () => {
    const req = buildRequest({});
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid projectId");
  });

  it("returns 400 when projectId is not a string", async () => {
    const req = buildRequest({ projectId: 123 });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid projectId");
  });

  it("returns 404 when project not found", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

    const req = buildRequest({ projectId: MOCK_PROJECT_ID });
    const res = await POST(req);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Project not found");
  });

  it("returns 404 when user does not own project", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: MOCK_PROJECT_ID,
      userId: "different-user-id",
      createdAt: new Date(),
      updatedAt: new Date(),
      propertyAddress: "123 Test St",
      clientName: "Test Client",
      targetBuyer: "Family",
      stagingAesthetic: "Modern",
      roiSalesPricePremium: null,
      roiTransactionVelocity: null,
      roiInvestmentTier: null,
      stagingDirectives: null,
      buyerDemographics: null,
      stagingPackage: null,
      clientSignature: null,
      clientSignatureStatus: null,
      clientSignatureTimestamp: null,
    } as never);

    const req = buildRequest({ projectId: MOCK_PROJECT_ID });
    const res = await POST(req);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Project not found");
  });

  it("returns 500 when BROWSERLESS_API_KEY is missing", async () => {
    process.env.BROWSERLESS_API_KEY = "";

    const req = buildRequest({ projectId: MOCK_PROJECT_ID });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Configuration missing");
  });

  it("returns 401 when Browserless returns 401", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
      headers: new Map([["content-type", "text/plain"]]),
    });
    global.fetch = mockFetch;

    const req = buildRequest({ projectId: MOCK_PROJECT_ID });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Authentication failed");
  });

  it("returns 403 when Browserless returns 403", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden"),
      headers: new Map([["content-type", "text/plain"]]),
    });
    global.fetch = mockFetch;

    const req = buildRequest({ projectId: MOCK_PROJECT_ID });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Authentication failed");
  });

  it("returns 429 when Browserless returns 429", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Rate limited"),
      headers: new Map([["content-type", "text/plain"]]),
    });
    global.fetch = mockFetch;

    const req = buildRequest({ projectId: MOCK_PROJECT_ID });
    const res = await POST(req);

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe("Rate limit exceeded");
    expect(json.retryable).toBe(true);
  });

  it("returns 502 when response is not a PDF", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
      headers: new Map([["content-type", "text/html"]]),
    });
    global.fetch = mockFetch;

    const req = buildRequest({ projectId: MOCK_PROJECT_ID });
    const res = await POST(req);

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("PDF generation failed");
  });

  it("returns 502 when response is empty", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      headers: new Map([["content-type", "application/pdf"]]),
    });
    global.fetch = mockFetch;

    const req = buildRequest({ projectId: MOCK_PROJECT_ID });
    const res = await POST(req);

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("PDF generation failed");
  });

  it("returns 200 with PDF buffer on success", async () => {
    const pdfContent = "%PDF-1.4 fake pdf content";
    const encoder = new TextEncoder();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(encoder.encode(pdfContent).buffer),
      headers: new Map([["content-type", "application/pdf"]]),
    });
    global.fetch = mockFetch;

    const req = buildRequest({ projectId: MOCK_PROJECT_ID });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(recordDailyUsage).toHaveBeenCalledWith("export", MOCK_USER_ID);
  });

  it("does not count Browserless errors against daily quota", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal error"),
      headers: new Map([["content-type", "text/plain"]]),
    });
    global.fetch = mockFetch;

    const req = buildRequest({ projectId: MOCK_PROJECT_ID });
    await POST(req);

    expect(recordDailyUsage).not.toHaveBeenCalled();
  });
});

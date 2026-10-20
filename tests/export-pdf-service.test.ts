/**
 * Unit tests for `src/lib/export-pdf-service.ts`.
 *
 * Phase-2 of the Wave-5 revival (issue #1389): pins the discriminated
 * result returned by `runExportPdf` so the unversioned /api/export-pdf
 * route and the /api/v1/export-pdf route can each keep their own
 * terminal mapping without regressing the shared orchestration.
 *
 * Hand-rolls the dependency surface with `vi.fn()`s (no `vi.mock`,
 * mirroring Phase-1 services in #1400/#1401).
 */
import { describe, expect, it, vi } from "vitest";

import {
  ProjectForbiddenError,
  ProjectNotFoundError,
} from "@/lib/api-auth";

import { runExportPdf, defaultExportPdfServiceDeps } from "@/lib/export-pdf-service";
import type { ExportPdfServiceDeps } from "@/lib/export-pdf-service";
import { requireUser } from "@/lib/test/require-user";

type Deps = ExportPdfServiceDeps;

const makeDeps = (overrides: Partial<Deps> = {}): Deps => {
  // Issue #1393: shared `requireUser()` factory. Fresh `vi.fn()` per call
  // so each test's per-assert call count is independent.
  const { mockGetAuthedPrismaUser } = requireUser({ id: "user-1" });
  const now = new Date("2026-10-20T12:00:00Z");
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
  const fetchImpl = vi.fn(
    async () =>
      new Response(pdfBytes, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
  ) as unknown as typeof fetch;
  const base: Deps = {
    getAuthedPrismaUser: mockGetAuthedPrismaUser,
    requireProjectOwnershipOrThrow: vi.fn(async () => ({ ok: true as const, projectId: PROJECT_ID })),
    claimDailyQuota: vi.fn(async () =>
      ({
        claimed: true,
        allowed: true,
        used: 1,
        limit: 20,
        remaining: 19,
      }) as never
    ),
    resolveDailyLimit: vi.fn(() => 20),
    signPreviewToken: vi.fn(async () => "signed-token"),
    fetchBrowserlessPdfWithCircuitBreaker: vi.fn(
      async () =>
        new Response(pdfBytes, {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
    ),
    resolveBrowserlessPdfUrl: vi.fn(() => "https://mock-browserless/pdf"),
    getEnv: vi.fn((name: string) => {
      if (name === "NEXT_PUBLIC_APP_URL") return "http://localhost:3000";
      if (name === "NODE_ENV") return "development";
      if (name === "BROWSERLESS_API_KEY") return "test-key";
      if (name === "DAILY_EXPORT_LIMIT") return "20";
      if (name === "E2E_HERMETIC") return undefined;
      if (name === "E2E_BROWSERLESS_PDF_URL") return undefined;
      return undefined;
    }),
    fetchImpl,
    now: () => now,
  };
  return { ...base, ...overrides };
};

const PROJECT_ID = "c" + "a".repeat(23) + "z";

const VALID_BODY = JSON.stringify({ projectId: PROJECT_ID });

describe("defaultExportPdfServiceDeps", () => {
  it("exposes a real getEnv that reads from process.env", () => {
    const deps = defaultExportPdfServiceDeps();
    // Touch every dep so the linter complains if any drift away.
    expect(typeof deps.getEnv).toBe("function");
    expect(typeof deps.getAuthedPrismaUser).toBe("function");
    expect(typeof deps.requireProjectOwnershipOrThrow).toBe("function");
    expect(typeof deps.claimDailyQuota).toBe("function");
    expect(typeof deps.resolveDailyLimit).toBe("function");
    expect(typeof deps.signPreviewToken).toBe("function");
    expect(typeof deps.fetchBrowserlessPdfWithCircuitBreaker).toBe("function");
    expect(typeof deps.resolveBrowserlessPdfUrl).toBe("function");
    expect(typeof deps.fetchImpl).toBe("function");
    expect(typeof deps.now).toBe("function");
  });
});

describe("runExportPdf body parsing", () => {
  it("returns invalidRequest when body is not JSON", async () => {
    const deps = makeDeps();
    const out = await runExportPdf({ bodyText: "not-json" }, deps);
    expect(out).toMatchObject({ kind: "invalidRequest" });
    if (out.kind !== "invalidRequest") return;
    expect(out.message).toMatch(/JSON/);
  });

  it("returns invalidRequest when body is not an object", async () => {
    const deps = makeDeps();
    const out = await runExportPdf({ bodyText: JSON.stringify("hi") }, deps);
    expect(out).toMatchObject({ kind: "invalidRequest" });
  });

  it("returns invalidRequest when projectId is missing", async () => {
    const deps = makeDeps();
    const out = await runExportPdf(
      { bodyText: JSON.stringify({}) },
      deps,
    );
    expect(out).toMatchObject({ kind: "invalidRequest" });
  });

  it("returns invalidRequest when projectId is not a CUID", async () => {
    const deps = makeDeps();
    const out = await runExportPdf(
      { bodyText: JSON.stringify({ projectId: "not-a-cuid" }) },
      deps,
    );
    expect(out).toMatchObject({ kind: "invalidRequest" });
  });
});

describe("runExportPdf auth + ownership", () => {
  it("returns unauthorized when no user", async () => {
    const deps = makeDeps({
      getAuthedPrismaUser: vi.fn(async () => null),
    });
    const out = await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(out).toEqual({ kind: "unauthorized" });
  });

  it("returns projectNotFound on ProjectNotFoundError", async () => {
    const deps = makeDeps({
      requireProjectOwnershipOrThrow: vi.fn(async () => {
        throw new ProjectNotFoundError(PROJECT_ID);
      }),
    });
    const out = await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(out).toEqual({ kind: "projectNotFound" });
  });

  it("returns projectForbidden on ProjectForbiddenError", async () => {
    const deps = makeDeps({
      requireProjectOwnershipOrThrow: vi.fn(async () => {
        throw new ProjectForbiddenError(PROJECT_ID);
      }),
    });
    const out = await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(out).toEqual({ kind: "projectForbidden" });
  });

  it("rethrows non-Project errors so they surface as 500", async () => {
    const boom = new Error("db-down");
    const deps = makeDeps({
      requireProjectOwnershipOrThrow: vi.fn(async () => {
        throw boom;
      }),
    });
    await expect(runExportPdf({ bodyText: VALID_BODY }, deps!)).rejects.toBe(boom);
  });
});

describe("runExportPdf configuration guards", () => {
  it("returns missingConfig(appUrl) when NODE_ENV=production and NEXT_PUBLIC_APP_URL is unset", async () => {
    const deps = makeDeps({
      getEnv: vi.fn((name: string) =>
        name === "NODE_ENV" ? "production" : undefined,
      ),
    });
    const out = await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(out).toEqual({ kind: "missingConfig", reason: "appUrl" });
  });

  it("falls back to localhost when NEXT_PUBLIC_APP_URL is empty in development", async () => {
    let observedUrl = "";
    const deps = makeDeps({
      getEnv: vi.fn((name: string) => {
        if (name === "NEXT_PUBLIC_APP_URL") return "";
        if (name === "NODE_ENV") return "development";
        if (name === "BROWSERLESS_API_KEY") return "test-key";
        return undefined;
      }),
      fetchBrowserlessPdfWithCircuitBreaker: vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init.body)) as { url: string };
        observedUrl = body.url;
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }),
    });
    const out = await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(out.kind).toBe("fetchResult");
    expect(observedUrl).toMatch(/^http:\/\/localhost:3000\/preview\//);
  });

  it("returns missingConfig(browserlessApiKey) when BROWSERLESS_API_KEY is unset", async () => {
    const deps = makeDeps({
      getEnv: vi.fn((name: string) => {
        if (name === "NEXT_PUBLIC_APP_URL") return "http://localhost:3000";
        if (name === "NODE_ENV") return "development";
        return undefined;
      }),
    });
    const out = await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(out).toEqual({ kind: "missingConfig", reason: "browserlessApiKey" });
  });
});

describe("runExportPdf quota", () => {
  it("returns quotaExceeded with the payload + claim when claim fails", async () => {
    const deps = makeDeps({
      claimDailyQuota: vi.fn(async () =>
        ({
          claimed: false,
          allowed: false,
          used: 20,
          limit: 20,
          resetsAt: "2026-10-21T00:00:00.000Z",
        }) as never
      ),
    });
    const out = await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(out.kind).toBe("quotaExceeded");
    if (out.kind !== "quotaExceeded") return;
    expect(out.claim.used).toBe(20);
    expect(out.payload.error).toBe("Daily limit reached");
  });

  it("calls claimDailyQuota with surface=export, userId, limit, count=1, now", async () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const deps = makeDeps({ now: () => now });
    await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(deps!.claimDailyQuota).toHaveBeenCalledWith(
      "export",
      "user-1",
      20,
      1,
      now,
    );
  });
});

describe("runExportPdf fetch path", () => {
  it("emits the preview URL with the signed token and capture marker", async () => {
    let observedBody: unknown = null;
    const deps = makeDeps({
      fetchBrowserlessPdfWithCircuitBreaker: vi.fn(async (_url, init) => {
        observedBody = JSON.parse(String(init.body));
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }),
    });
    await runExportPdf({ bodyText: VALID_BODY }, deps!);
    const body = observedBody as { url: string };
    expect(body.url).toContain(`/preview/${PROJECT_ID}`);
    expect(body.url).toContain("token=signed-token");
    expect(body.url).toContain("capture=pdf");
  });

  it("uses viewport 816x1056 (Letter @ 96dpi) and zero margins", async () => {
    let observedBody: unknown = null;
    const deps = makeDeps({
      fetchBrowserlessPdfWithCircuitBreaker: vi.fn(async (_url, init) => {
        observedBody = JSON.parse(String(init.body));
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }),
    });
    await runExportPdf({ bodyText: VALID_BODY }, deps!);
    const body = observedBody as {
      options: {
        margin: Record<string, number>;
        media: string;
        scale: number;
        displayHeaderFooter: boolean;
        printBackground: boolean;
      };
      viewport: { width: number; height: number };
    };
    expect(body.viewport).toEqual({ width: 816, height: 1056 });
    expect(body.options.media).toBe("print");
    expect(body.options.scale).toBe(1);
    expect(body.options.displayHeaderFooter).toBe(false);
    expect(body.options.printBackground).toBe(true);
    expect(body.options.margin).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it("signs the outbound Browserless request with a Basic Authorization header carrying BROWSERLESS_API_KEY", async () => {
    let observedHeaders: Record<string, string> | undefined;
    const deps = makeDeps({
      fetchBrowserlessPdfWithCircuitBreaker: vi.fn(async (_url, init) => {
        observedHeaders = init.headers as Record<string, string>;
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }),
      getEnv: ((name: string) =>
        name === "BROWSERLESS_API_KEY" ? "test-key" : process.env[name]) as (
          name: string,
        ) => string | undefined,
    });
    await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(observedHeaders).toBeDefined();
    expect(observedHeaders!["Authorization"]).toBe(
      `Basic ${Buffer.from("test-key:").toString("base64")}`,
    );
  });

  it("returns missingConfig when BROWSERLESS_API_KEY is unset on the dispatched fetch path", async () => {
    const fetchMock = vi.fn();
    const deps = makeDeps({
      fetchBrowserlessPdfWithCircuitBreaker: fetchMock,
      getEnv: ((name: string) =>
        name === "BROWSERLESS_API_KEY"
          ? undefined
          : name === "NEXT_PUBLIC_APP_URL"
            ? "https://app.example.test"
            : name === "PREVIEW_TOKEN_SECRET"
              ? "test-secret"
              : undefined) as (name: string) => string | undefined,
    });
    const result = await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(result.kind).toBe("missingConfig");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a pdf kind with buffer + contentType when upstream answers 2xx + application/pdf", async () => {
    const deps = makeDeps();
    const out = await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(out.kind).toBe("fetchResult");
    if (out.kind !== "fetchResult") return;
    expect(out.fetch.kind).toBe("pdf");
    if (out.fetch.kind !== "pdf") return;
    expect(out.fetch.upstreamStatus).toBe(200);
    expect(out.fetch.contentType).toMatch(/application\/pdf/);
    expect(out.fetch.buffer.byteLength).toBeGreaterThan(0);
  });

  it("returns browserlessError carrying raw upstream status (does NOT normalize)", async () => {
    const deps = makeDeps({
      fetchBrowserlessPdfWithCircuitBreaker: vi.fn(
        async () => new Response("rate limited", { status: 429 }),
      ),
    });
    const out = await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(out.kind).toBe("fetchResult");
    if (out.kind !== "fetchResult") return;
    expect(out.fetch.kind).toBe("browserlessError");
    if (out.fetch.kind !== "browserlessError") return;
    expect(out.fetch.status).toBe(429);
    expect(out.fetch.errorText).toContain("rate limited");
  });

  it("returns nonPdfResponse when upstream answers 200 with text/html", async () => {
    const deps = makeDeps({
      fetchBrowserlessPdfWithCircuitBreaker: vi.fn(
        async () =>
          new Response("<html>denied</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ),
    });
    const out = await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(out.kind).toBe("fetchResult");
    if (out.kind !== "fetchResult") return;
    expect(out.fetch.kind).toBe("nonPdfResponse");
    if (out.fetch.kind !== "nonPdfResponse") return;
    expect(out.fetch.upstreamStatus).toBe(200);
    expect(out.fetch.contentType).toMatch(/text\/html/);
  });

  it("resolves the Browserless URL via resolveBrowserlessPdfUrl (hermetic-gated seam)", async () => {
    const deps = makeDeps({
      resolveBrowserlessPdfUrl: vi.fn(
        (_h, override) => override ?? "https://mock-browserless/pdf",
      ),
    });
    await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(deps.resolveBrowserlessPdfUrl).toHaveBeenCalled();
  });

  it("calls fetchBrowserlessPdfWithCircuitBreaker with the resolved URL", async () => {
    const deps = makeDeps({
      resolveBrowserlessPdfUrl: vi.fn(() => "https://custom-endpoint/pdf"),
    });
    await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(deps.fetchBrowserlessPdfWithCircuitBreaker).toHaveBeenCalledWith(
      "https://custom-endpoint/pdf",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("signs the preview token with the projectId only", async () => {
    const deps = makeDeps();
    await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(deps.signPreviewToken).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("resolves the daily export limit with envValue + fallback", async () => {
    const deps = makeDeps({
      getEnv: vi.fn((name: string) => {
        if (name === "DAILY_EXPORT_LIMIT") return "5";
        if (name === "NEXT_PUBLIC_APP_URL") return "http://localhost:3000";
        if (name === "NODE_ENV") return "development";
        if (name === "BROWSERLESS_API_KEY") return "test-key";
        return undefined;
      }),
      resolveDailyLimit: vi.fn((_raw, fallback) =>
        typeof _raw === "string" && _raw.trim() !== "" ? Number(_raw) : fallback,
      ),
      claimDailyQuota: vi.fn(async (_surface, _userId, limit) =>
        ({
          claimed: true,
          allowed: true,
          used: 1,
          limit,
          remaining: limit - 1,
        }) as never
      ),
    });
    await runExportPdf({ bodyText: VALID_BODY }, deps!);
    expect(deps!.resolveDailyLimit).toHaveBeenCalledWith("5", 20);
    expect(deps!.claimDailyQuota).toHaveBeenCalledWith(
      "export",
      "user-1",
      5,
      1,
      expect.any(Date),
    );
  });
});
/**
 * Export PDF service — extracted orchestration for the Browserless-backed
 * lookbook PDF export endpoint.
 *
 * Wave-5 revival (issue #1389): the unversioned /api/export-pdf and the
 * /api/v1/export-pdf routes shared ~280 lines of near-identical
 * orchestration (auth → body parse → ownership → quota → preview URL → fetch)
 * but their terminal response shapes disagree on purpose:
 *   - unversioned propagates the raw upstream status (401/403 → 401/403,
 *     429 → 429, other non-2xx → echoed status, non-PDF body → 502), and
 *     renames the filename to `project-<id>.pdf`.
 *   - v1 flattens every non-ok Browserless response to 500 invalid-request,
 *     uses the filename `staging-report-<id>.pdf`, and decorates every
 *     response with `buildVersionHeaders("v1")`.
 *
 * This service performs the shared steps and returns a discriminated union
 * describing the outcome. Routes keep their own terminal mapping so each
 * version's contract stays pinned by its existing e2e specs (#1084). The
 * `kind: 'fetchResult'` arm deliberately exposes the raw upstream status;
 * normalizing here would silently rewrite the v1 contract.
 */
import type { User } from "@prisma/client";

import {
  ProjectForbiddenError,
  ProjectNotFoundError,
  getAuthedPrismaUser,
  requireProjectOwnershipOrThrow,
} from "@/lib/api-auth";
import {
  DEFAULT_DAILY_EXPORT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  claimDailyQuota,
  dailyQuotaExceededPayload,
  resolveDailyLimit,
} from "@/lib/api-quota";
import {
  fetchBrowserlessPdfWithCircuitBreaker,
  resolveBrowserlessPdfUrl,
} from "@/lib/browserless";
import {
  PREVIEW_CAPTURE_QUERY_PARAM,
  PREVIEW_CAPTURE_QUERY_VALUE,
  PREVIEW_TOKEN_QUERY_PARAM,
  signPreviewToken,
} from "@/lib/preview-token";

import type { QuotaClaim } from "@/lib/api-quota";

// Re-export so callers (and the print-css test, which greps the route
// source for the literal `${PREVIEW_CAPTURE_QUERY_PARAM}=${PREVIEW_CAPTURE_QUERY_VALUE}`)
// can keep referring to one source of truth.
export { PREVIEW_CAPTURE_QUERY_PARAM, PREVIEW_CAPTURE_QUERY_VALUE };

const PROJECT_ID_PATTERN = /^c[a-z0-9]{24}$/;

/**
 * The shape returned by `runExportPdf`. Each `kind` maps to a single
 * route-level outcome; the route owns the status-code + payload-name
 * mapping so it stays free to preserve its pinned contract.
 */
export type ExportPdfServiceResult =
  | { kind: "unauthorized" }
  | { kind: "invalidRequest"; message: string }
  | { kind: "projectNotFound" }
  | { kind: "projectForbidden" }
  | { kind: "quotaExceeded"; payload: ReturnType<typeof dailyQuotaExceededPayload>; claim: QuotaClaim }
  | { kind: "missingConfig"; reason: "appUrl" | "browserlessApiKey" }
  | { kind: "fetchResult"; fetch: ExportPdfFetchResult };

/**
 * The result of the Browserless fetch itself. The unversioned route also
 * cares whether the upstream responded with a non-PDF body (issue #1084:
 * the spec for export-pdf asserts 502 on that case); the v1 route collapses
 * it into the generic `browserlessError` arm. Both arms carry the raw
 * upstream status so neither route needs to re-fetch.
 */
export type ExportPdfFetchResult =
  | {
      kind: "pdf";
      buffer: ArrayBuffer;
      contentType: string | null;
      upstreamStatus: number;
    }
  | {
      kind: "browserlessError";
      status: number;
      errorText: string;
    }
  | {
      kind: "nonPdfResponse";
      contentType: string | null;
      upstreamStatus: number;
      bodyBytes: number;
    };

export type ExportPdfServiceInput = {
  bodyText: string;
};

/**
 * Narrow dependency surface for the service. Inlined (not picked off a
 * module singleton) so the test can hand-roll `vi.fn()`s and the route
 * composes real implementations. The export-pdf surface is read-mostly
 * with no fal inference — only Browserless, so no inference client is
 * threaded through. Mirrors the Phase-1 services (#1400, #1401).
 */
export type ExportPdfServiceDeps = {
  getAuthedPrismaUser: typeof getAuthedPrismaUser;
  requireProjectOwnershipOrThrow: typeof requireProjectOwnershipOrThrow;
  claimDailyQuota: typeof claimDailyQuota;
  resolveDailyLimit: typeof resolveDailyLimit;
  signPreviewToken: typeof signPreviewToken;
  fetchBrowserlessPdfWithCircuitBreaker: typeof fetchBrowserlessPdfWithCircuitBreaker;
  resolveBrowserlessPdfUrl: (
    e2eHermetic: string | undefined,
    e2eBrowserlessPdfUrl: string | undefined,
  ) => string;
  getEnv: (name: string) => string | undefined;
  fetchImpl: typeof fetch;
  now: () => Date;
};

export const defaultExportPdfServiceDeps = (): ExportPdfServiceDeps => ({
  getAuthedPrismaUser,
  requireProjectOwnershipOrThrow,
  claimDailyQuota,
  resolveDailyLimit,
  signPreviewToken,
  fetchBrowserlessPdfWithCircuitBreaker,
  resolveBrowserlessPdfUrl,
  getEnv: (name) => process.env[name],
  fetchImpl: fetch,
  now: () => new Date(),
});

/**
 * Read and validate the JSON request body, returning either the
 * `projectId` (a CUID) or an `{ kind: 'invalidRequest', message }` shape
 * the route maps to a 400 with `code: API_ERROR_INVALID_REQUEST`.
 *
 * Kept inside the service because both the unversioned and the v1 routes
 * fail with the same 400/code/message shape on malformed JSON, non-object
 * input, or a non-CUID `projectId`.
 */
function parseExportPdfBody(bodyText: string):
  | { ok: true; projectId: string }
  | { ok: false; message: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const { projectId } = payload as { projectId?: unknown };
  if (typeof projectId !== "string" || !PROJECT_ID_PATTERN.test(projectId)) {
    return {
      ok: false,
      message: "projectId must be a valid CUID",
    };
  }
  return { ok: true, projectId };
}

/**
 * Resolve the public preview URL handed to the Browserless cloud browser.
 * Falls back to the localhost dev URL when not in production; production
 * missing-appUrl is bubbled as `{ kind: 'missingConfig', reason: 'appUrl' }`
 * so the route maps it to a 500 (the v1 contract answers this with a
 * "Configuration missing" payload).
 */
function resolveAppUrl(
  rawUrl: string | undefined,
  nodeEnv: string | undefined,
):
  | { ok: true; url: string }
  | { ok: false } {
  let appUrl = rawUrl;
  if (!appUrl || appUrl.trim() === "") {
    if (nodeEnv === "production") {
      return { ok: false };
    }
    appUrl = "http://localhost:3000";
  }
  return { ok: true, url: appUrl };
}

/**
 * Read the PDF buffer from the upstream Browserless response and
 * classify the outcome.
 *
 * - 2xx with a `application/pdf` content-type AND a `%PDF` magic prefix
 *   → `{ kind: 'pdf' }`
 * - any non-2xx status → `{ kind: 'browserlessError' }` carrying the raw
 *   status and a best-effort error body for the route to log
 * - 2xx with anything else (an HTML error page slipped through, an empty
 *   body, a wrong content-type, or no `%PDF` magic) → `{ kind: 'nonPdfResponse' }`
 *   so the unversioned route can answer 502 (issue #1084) without the v1
 *   route having to know about it. Issue #1124: an HTML error page that
 *   slipped through with a 200 consumed Browserless compute and counts
 *   against the user's daily cap, so the unit stays claimed.
 */
async function classifyBrowserlessResponse(
  response: Response,
): Promise<ExportPdfFetchResult> {
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return { kind: "browserlessError", status: response.status, errorText };
  }

  const contentType = response.headers.get("content-type");
  const buffer = await response.arrayBuffer();
  const isPdfContentType = !!contentType && contentType.toLowerCase().includes("pdf");
  const leadingBytes = buffer.byteLength >= 4
    ? String.fromCharCode(...new Uint8Array(buffer.slice(0, 4)))
    : "";

  if (isPdfContentType && leadingBytes === "%PDF") {
    return { kind: "pdf", buffer, contentType, upstreamStatus: response.status };
  }

  return {
    kind: "nonPdfResponse",
    contentType,
    upstreamStatus: response.status,
    bodyBytes: buffer.byteLength,
  };
}

/**
 * Run the shared export-pdf orchestration. The route owns the status
 * code, response body shape, filename, and headers.
 */
export async function runExportPdf(
  input: ExportPdfServiceInput,
  deps: ExportPdfServiceDeps = defaultExportPdfServiceDeps(),
): Promise<ExportPdfServiceResult> {
  const parsed = parseExportPdfBody(input.bodyText);
  if (!parsed.ok) {
    return { kind: "invalidRequest", message: parsed.message };
  }
  const { projectId } = parsed;

  const user: User | null = await deps.getAuthedPrismaUser();
  if (!user) {
    return { kind: "unauthorized" };
  }

  try {
    await deps.requireProjectOwnershipOrThrow(projectId, user);
  } catch (e) {
    if (e instanceof ProjectNotFoundError) {
      return { kind: "projectNotFound" };
    }
    if (e instanceof ProjectForbiddenError) {
      return { kind: "projectForbidden" };
    }
    throw e;
  }

  const appUrl = resolveAppUrl(
    deps.getEnv("NEXT_PUBLIC_APP_URL"),
    deps.getEnv("NODE_ENV"),
  );
  if (!appUrl.ok) {
    return { kind: "missingConfig", reason: "appUrl" };
  }

  if (!deps.getEnv("BROWSERLESS_API_KEY")) {
    return { kind: "missingConfig", reason: "browserlessApiKey" };
  }

  const exportLimit = deps.resolveDailyLimit(
    deps.getEnv(DAILY_LIMIT_ENV_VAR.export),
    DEFAULT_DAILY_EXPORT_LIMIT,
  );

  const exportClaim = await deps.claimDailyQuota(
    "export",
    user.id,
    exportLimit,
    1,
    deps.now(),
  );
  if (!exportClaim.claimed) {
    return {
      kind: "quotaExceeded",
      payload: dailyQuotaExceededPayload(exportClaim, "Please try again tomorrow."),
      claim: exportClaim,
    };
  }

  const token = await deps.signPreviewToken(projectId);
  const previewUrl =
    `${appUrl.url}/preview/${projectId}` +
    `?${PREVIEW_TOKEN_QUERY_PARAM}=${encodeURIComponent(token)}` +
    `&${PREVIEW_CAPTURE_QUERY_PARAM}=${PREVIEW_CAPTURE_QUERY_VALUE}`;

  const browserlessUrl = deps.resolveBrowserlessPdfUrl(
    deps.getEnv("E2E_HERMETIC"),
    deps.getEnv("E2E_BROWSERLESS_PDF_URL"),
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  try {
    const chromeResponse = await deps.fetchBrowserlessPdfWithCircuitBreaker(
      browserlessUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
        body: JSON.stringify({
          url: previewUrl,
          options: {
            gotoOptions: { waitUntil: "networkidle2", timeout: 60_000 },
            media: "print",
            scale: 1,
            displayHeaderFooter: false,
            printBackground: true,
            margin: { top: 0, bottom: 0, left: 0, right: 0 },
          },
          // 8.5 x 11 inch @ 96dpi → 816 x 1056 px (CSS px). Letter portrait,
          // zero margins so the print CSS owns the safe area.
          viewport: { width: 816, height: 1056 },
          goto: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
        }),
        signal: controller.signal,
      },
    );

    const fetch = await classifyBrowserlessResponse(chromeResponse);
    return { kind: "fetchResult", fetch };
  } finally {
    clearTimeout(timeoutId);
  }
}
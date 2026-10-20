import { NextRequest, NextResponse } from "next/server";

import { buildDeprecationHeaders } from "@/lib/api-version";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_PDF_AUTHENTICATION_FAILED,
  API_ERROR_PDF_GENERATION_FAILED,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_EXPORT_FAILED,
} from "@/lib/api-errors";
import { classifyIntegrationError } from "@/lib/error-classify";
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  PREVIEW_CAPTURE_QUERY_PARAM,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  PREVIEW_CAPTURE_QUERY_VALUE,
  runExportPdf,
} from "@/lib/export-pdf-service";

// Tests/print-css.test.ts greps this file for `${PREVIEW_CAPTURE_QUERY_PARAM}=${PREVIEW_CAPTURE_QUERY_VALUE}`.
// The actual URL build lives in `runExportPdf`; the imports above keep the
// single-source-of-truth contract intact for the assertion.

/**
 * Unversioned POST /api/export-pdf.
 *
 * Wave-5 revival (issue #1389): the orchestration (auth, body parse,
 * ownership, quota claim, preview-token + URL build, Browserless fetch
 * + circuit breaker) lives in `lib/export-pdf-service.ts`. This handler
 * only maps the discriminated result to the route's pinned HTTP shape:
 *
 * - propagates the raw upstream status on `browserlessError` (401/403 → 401/403,
 *   429 → 429, other non-2xx → echoed status) — see issue #1084.
 * - answers 502 when the upstream returned a 2xx with a non-PDF body (issue #1084:
 *   `export-pdf.spec.ts` pins this; the unit is NOT refunded, per issue #1124).
 * - filenames the response `project-<id>.pdf` and decorates every reply with
 *   `buildDeprecationHeaders()` so clients can migrate to /api/v1/export-pdf.
 */

const EXPORT_PDF_ERROR_COPY = {
  auth: {
    error: "Authentication failed",
    message: "PDF export service authentication failed. Please contact support.",
    code: API_ERROR_PDF_AUTHENTICATION_FAILED,
  },
  timeout: {
    error: "PDF export timed out",
    message: "PDF generation took too long. Please try again in a moment.",
    code: API_ERROR_PDF_GENERATION_FAILED,
  },
  network: {
    error: "Network error",
    message: "Unable to reach the PDF export service. Please check your connection and try again.",
    code: API_ERROR_EXPORT_FAILED,
  },
  unknown: {
    error: "PDF export failed",
    message: "An unexpected error occurred while generating the PDF. Please try again.",
    code: API_ERROR_EXPORT_FAILED,
  },
};

// Browserless fetch + auth/DB overhead comfortably fit under 90s.
// Default App Router limit is 10s, which is too short for PDF export.
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  let projectId: string | undefined;
  let bodyText = "";
  try {
    bodyText = await req.text();
    const result = await runExportPdf({ bodyText });

    switch (result.kind) {
      case "unauthorized":
        return NextResponse.json(
          {
            error: "Unauthorized",
            message: "You must be signed in to export a PDF",
            code: API_ERROR_UNAUTHORIZED,
          },
          { status: 401, headers: buildDeprecationHeaders() }
        );

      case "invalidRequest":
        return NextResponse.json(
          {
            error: "Invalid projectId",
            message: result.message,
            code: API_ERROR_INVALID_REQUEST,
          },
          { status: 400, headers: buildDeprecationHeaders() }
        );

      case "projectNotFound":
        return NextResponse.json(
          {
            error: "Project not found",
            message: "Project not found or no longer accessible",
            code: API_ERROR_INVALID_REQUEST,
          },
          { status: 404, headers: buildDeprecationHeaders() }
        );

      case "projectForbidden":
        return NextResponse.json(
          {
            error: "Forbidden",
            message: "You do not have permission to access this project.",
            code: API_ERROR_INVALID_REQUEST,
          },
          { status: 403, headers: buildDeprecationHeaders() }
        );

      case "quotaExceeded":
        return NextResponse.json(
          result.payload,
          { status: 429, headers: buildDeprecationHeaders() }
        );

      case "missingConfig":
        return NextResponse.json(
          {
            error: "Configuration missing",
            message: `Server is missing ${result.reason === "appUrl" ? "NEXT_PUBLIC_APP_URL" : "BROWSERLESS_API_KEY"}.`,
            code: API_ERROR_EXPORT_FAILED,
          },
          { status: 500, headers: buildDeprecationHeaders() }
        );

      case "fetchResult": {
        const fetch = result.fetch;
        projectId = projectIdFromBody(bodyText);

        if (fetch.kind === "pdf") {
          // No charge is written here: the unit was claimed atomically
          // before the render (issue #1132) and stays claimed on every
          // post-dispatch outcome (issue #1124).
          return new NextResponse(fetch.buffer, {
            status: 200,
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="project-${projectId ?? "unknown"}.pdf"`,
              ...buildDeprecationHeaders(),
            },
          });
        }

        if (fetch.kind === "nonPdfResponse") {
          console.error(
            JSON.stringify({
              event: "export_pdf_non_pdf_response",
              projectId,
              contentType: fetch.contentType,
              byteLength: fetch.bodyBytes,
            })
          );
          return NextResponse.json(
            {
              error: "PDF generation failed",
              message: "Unable to generate PDF at this time. Please try again.",
              retryable: true,
              code: API_ERROR_PDF_GENERATION_FAILED,
            },
            { status: 502, headers: buildDeprecationHeaders() }
          );
        }

        // fetch.kind === 'browserlessError' — propagate the raw status so
        // the e2e spec for the unversioned route keeps its 401/403/429/500
        // assertions (issue #1084). The v1 route has its own (different)
        // flattening that does NOT use this branch.
        const status = fetch.status;
        if (status === 401 || status === 403) {
          return NextResponse.json(
            {
              error: "Authentication failed",
              message: "PDF export service authentication failed. Please contact support.",
              code: API_ERROR_PDF_AUTHENTICATION_FAILED,
            },
            { status, headers: buildDeprecationHeaders() }
          );
        }
        if (status === 429) {
          return NextResponse.json(
            {
              error: "Rate limit exceeded",
              message: "PDF export service is busy. Please wait a moment and try again.",
              retryable: true,
              code: API_ERROR_RATE_LIMIT_EXCEEDED,
            },
            { status, headers: buildDeprecationHeaders() }
          );
        }
        return NextResponse.json(
          {
            error: "PDF generation failed",
            message: "Unable to generate PDF at this time. Please try again.",
            retryable: true,
            code: API_ERROR_PDF_GENERATION_FAILED,
          },
          { status, headers: buildDeprecationHeaders() }
        );
      }
    }
  } catch (error) {
    // Issue #1124: a dispatch that dies here (timeout abort, network
    // error) keeps its claim; it consumed or attempted Browserless
    // compute and counts toward the user's daily cap.
    console.error(
      JSON.stringify({
        event: "export_pdf_failed",
        projectId: projectIdFromBody(bodyText),
      }),
      error
    );

    const classified = classifyIntegrationError(error, EXPORT_PDF_ERROR_COPY);

    return NextResponse.json(
      {
        error: classified.error,
        message: classified.message,
        retryable: classified.retryable,
        code: classified.code,
      },
      { status: classified.status, headers: buildDeprecationHeaders() }
    );
  }
}

/**
 * Best-effort projectId extraction for log correlation. Returns
 * `undefined` when the body wasn't valid JSON / didn't carry a CUID; the
 * catch-all log line still records the absence.
 */
function projectIdFromBody(bodyText: string): string | undefined {
  if (!bodyText) return undefined;
  try {
    const parsed = JSON.parse(bodyText) as { projectId?: unknown };
    if (typeof parsed.projectId === "string" && /^c[a-z0-9]{24}$/.test(parsed.projectId)) {
      return parsed.projectId;
    }
  } catch {
    // fallthrough
  }
  return undefined;
}
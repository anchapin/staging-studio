/**
 * v1 Export PDF Route
 *
 * Rate-limited and ownership-checked PDF lookbook export endpoint.
 *
 * GET /api/v1/export-pdf?projectId=xxx
 */
import { NextRequest, NextResponse } from "next/server";

import {
  ProjectForbiddenError,
  ProjectNotFoundError,
  getAuthedPrismaUser,
  requireProjectOwnership,
} from "@/lib/api-auth";
import { buildVersionHeaders } from "@/lib/api-version";
import {
  DEFAULT_DAILY_EXPORT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  evaluateDailyQuota,
  getDailyUsage,
  recordDailyUsage,
  resolveDailyLimit,
} from "@/lib/api-quota";
import {
  BROWSERLESS_TIMEOUT_MS,
  buildBrowserlessPdfBody,
  buildBrowserlessPdfUrl,
  fetchBrowserlessPdfWithCircuitBreaker,
} from "@/lib/browserless";
import {
  API_ERROR_UNAUTHORIZED,
  API_ERROR_RATE_LIMIT_EXCEEDED,
  API_ERROR_INVALID_REQUEST,
  API_ERROR_PROJECT_NOT_FOUND,
} from "@/lib/api-errors";
import { signPreviewToken } from "@/lib/preview-token";

const PROJECT_ID_PATTERN = /^c[a-z0-9]{24}$/;
const PREVIEW_TOKEN_QUERY_PARAM = "token";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const versionInfo = buildVersionHeaders("v1");

  try {
    const user = await getAuthedPrismaUser();
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
          message: "You must be signed in to export a PDF.",
          code: API_ERROR_UNAUTHORIZED,
        },
        { status: 401, headers: versionInfo }
      );
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (typeof projectId !== "string" || !PROJECT_ID_PATTERN.test(projectId)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request",
          message: "projectId must be a valid CUID",
          code: API_ERROR_INVALID_REQUEST,
        },
        { status: 400, headers: versionInfo }
      );
    }

    // Check daily export quota
    const exportLimit = resolveDailyLimit(
      process.env[DAILY_LIMIT_ENV_VAR.export],
      DEFAULT_DAILY_EXPORT_LIMIT
    );
    const exportQuota = evaluateDailyQuota(
      await getDailyUsage("export", user.id),
      exportLimit
    );
    if (!exportQuota.allowed) {
      console.warn(
        JSON.stringify({
          event: "export_pdf_daily_quota_exceeded",
          userId: user.id,
          used: exportQuota.used,
          limit: exportQuota.limit,
        })
      );
      return NextResponse.json(
        {
          success: false,
          ...dailyQuotaExceededPayload(exportQuota, "Please try again tomorrow."),
          code: API_ERROR_RATE_LIMIT_EXCEEDED,
        },
        { status: 429, headers: versionInfo }
      );
    }

    // Fetch project and verify ownership
    try {
      await requireProjectOwnership(projectId, user);
    } catch (e) {
      if (e instanceof ProjectNotFoundError) {
        return NextResponse.json(
          {
            success: false,
            error: "Project not found",
            message: "Project does not exist",
            code: API_ERROR_PROJECT_NOT_FOUND,
          },
          { status: 404, headers: versionInfo }
        );
      }
      if (e instanceof ProjectForbiddenError) {
        return NextResponse.json(
          {
            success: false,
            error: "Forbidden",
            message: "You do not have permission to access this project.",
          },
          { status: 403, headers: versionInfo }
        );
      }
      throw e;
    }

    // App URL: the cloud browser must be able to reach this deployment
    let appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl || appUrl.trim() === "") {
      if (process.env.NODE_ENV === "production") {
        console.error(
          JSON.stringify({
            event: "export_pdf_app_url_missing",
            projectId,
          }),
          "NEXT_PUBLIC_APP_URL must be set in production (public URL of this deployment)."
        );
        return NextResponse.json(
          {
            success: false,
            error: "Configuration missing",
            message: "PDF export is not properly configured. Please contact support.",
          },
          { status: 500, headers: versionInfo }
        );
      }
      appUrl = "http://localhost:3000";
    }

    const apiKey = process.env.BROWSERLESS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Configuration missing",
          message: "PDF export service is not properly configured. Please contact support.",
        },
        { status: 500, headers: versionInfo }
      );
    }

    // Signed, short-lived, projectId-scoped token for cookie-less access
    const token = await signPreviewToken(projectId);
    const previewUrl = `${appUrl}/preview/${projectId}?${PREVIEW_TOKEN_QUERY_PARAM}=${encodeURIComponent(token)}`;

    // Fetch PDF with circuit breaker and timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      BROWSERLESS_TIMEOUT_MS
    );

    let chromeResponse: Response;
    try {
      chromeResponse = await fetchBrowserlessPdfWithCircuitBreaker(
        buildBrowserlessPdfUrl(),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
          },
          body: JSON.stringify(buildBrowserlessPdfBody(previewUrl)),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!chromeResponse.ok) {
      const errorText = await chromeResponse.text();
      console.error(
        JSON.stringify({
          event: "export_pdf_browserless_error",
          projectId,
          status: chromeResponse.status,
        }),
        errorText
      );

      if (chromeResponse.status === 401 || chromeResponse.status === 403) {
        return NextResponse.json(
          {
            success: false,
            error: "Service authentication failed",
            message: "PDF export service authentication failed. Please contact support.",
            code: API_ERROR_INVALID_REQUEST,
          },
          { status: 503, headers: versionInfo }
        );
      }

      return NextResponse.json(
        {
          success: false,
          error: "PDF generation failed",
          message: "Failed to generate PDF. Please try again.",
          code: API_ERROR_INVALID_REQUEST,
        },
        { status: 500, headers: versionInfo }
      );
    }

    // Record usage
    await recordDailyUsage("export", user.id);

    return new NextResponse(await chromeResponse.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="staging-report-${projectId}.pdf"`,
        ...versionInfo,
      },
    });
  } catch (error) {
    console.error("Export PDF error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal error",
        message: "An unexpected error occurred",
        code: "internal_error",
      },
      { status: 500, headers: versionInfo }
    );
  }
}

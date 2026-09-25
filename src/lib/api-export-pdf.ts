import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildBrowserlessPdfUrl,
  fetchBrowserlessPdfWithCircuitBreaker,
} from "@/lib/browserless";
import { signPreviewToken } from "@/lib/preview-token";
import { API_ERROR_PDF_GENERATION_FAILED } from "@/lib/api-errors";

export interface ExportPdfResult {
  pdfBuffer: Buffer;
  previewUrl: string;
}

export interface ExportPdfParams {
  userId: string;
  projectId: string;
  request: NextRequest;
}

export async function exportProjectPdf(
  params: ExportPdfParams
): Promise<ExportPdfResult> {
  const { projectId } = params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      clientName: true,
    },
  });
  if (!project) {
    throw new ExportNotFoundError();
  }

  const apiKey = process.env.BROWSERLESS_API_KEY;
  if (!apiKey) {
    throw new ExportConfigError();
  }

  const previewToken = await signPreviewToken(projectId);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const previewUrl = `${appUrl}/preview/${projectId}?token=${encodeURIComponent(previewToken)}`;

  const response = await fetchBrowserlessPdfWithRetry({
    apiKey,
    previewUrl,
  });

  const arrayBuffer = await response.arrayBuffer();
  const pdfBuffer = Buffer.from(arrayBuffer);

  return {
    pdfBuffer,
    previewUrl,
  };
}

interface FetchPdfParams {
  apiKey: string;
  previewUrl: string;
}

async function fetchBrowserlessPdfWithRetry(params: FetchPdfParams): Promise<Response> {
  const { apiKey, previewUrl } = params;

  let lastError: unknown;
  const MAX_RETRIES = 3;
  const RETRY_DELAY_BASE_MS = 2000;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1));
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        const response = await fetchBrowserlessPdfWithCircuitBreaker(
          buildBrowserlessPdfUrl(),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
            },
            body: JSON.stringify({
              url: previewUrl,
              options: {
                waitFor: 3000,
                printWind: true,
              },
            }),
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error(
            JSON.stringify({
              event: "export_pdf_browserless_error",
              status: response.status,
              error: errorText,
            })
          );
          if (response.status === 401 || response.status === 403) {
            throw new ExportAuthError();
          }
          throw new ExportServiceError({
            error: "PDF generation failed",
            message: `Browserless returned status ${response.status}`,
            retryable: true,
            code: API_ERROR_PDF_GENERATION_FAILED,
          });
        }

        return response;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      lastError = err;
      const isRetryable =
        err instanceof Error &&
        (err.message.includes("rate limit") ||
          err.message.includes("timeout") ||
          err.message.includes("temporary") ||
          err.message.includes("service unavailable") ||
          err instanceof ExportServiceError);
      if (!isRetryable) {
        throw err;
      }
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new ExportServiceError({
    error: "Export failed",
    message: "Could not generate the PDF after multiple attempts.",
    retryable: true,
    code: "EXPORT_FAILED",
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ExportNotFoundError extends Error {
  constructor() {
    super("Project not found");
    this.name = "ExportNotFoundError";
  }
}

export class ExportConfigError extends Error {
  constructor() {
    super("PDF export is not available. Please check your setup.");
    this.name = "ExportConfigError";
  }
}

export class ExportAuthError extends Error {
  constructor() {
    super("PDF export service authentication failed. Please contact support.");
    this.name = "ExportAuthError";
  }
}

export class ExportServiceError extends Error {
  code: string;
  retryable: boolean;

  constructor(classified: { error: string; message: string; retryable: boolean; code: string }) {
    super(classified.message);
    this.name = "ExportServiceError";
    this.code = classified.code;
    this.retryable = classified.retryable;
  }
}

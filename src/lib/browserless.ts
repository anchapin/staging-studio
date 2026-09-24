export const BROWSERLESS_PDF_ENDPOINT = "https://chrome.browserless.io/pdf";

export const BROWSERLESS_TIMEOUT_MS = 60_000;

import { getCircuitBreaker } from "@/lib/circuit-breaker";

export interface BrowserlessPdfBody {
  url: string;
  gotoOptions: { waitUntil: "networkidle0" };
  options: {
    printBackground: boolean;
    format: "Letter";
    margin: {
      top: string;
      right: string;
      bottom: string;
      left: string;
    };
  };
}

/**
 * Builds the Browserless.io PDF endpoint URL.
 *
 * Contract: returns the fixed `https://chrome.browserless.io/pdf` endpoint
 * with NO query string — the Browserless API key deliberately never rides
 * in the URL; it is sent as the request `Authorization` header (Basic
 * `apiKey:`) at the call site. Tests pin the credential-free URL shape.
 * Side effects: none (pure).
 */
export function buildBrowserlessPdfUrl(): string {
  return BROWSERLESS_PDF_ENDPOINT;
}

/**
 * Builds the Browserless.io PDF request body.
 *
 * Contract: renders `previewUrl` as the page to print with
 * `gotoOptions.waitUntil: "networkidle0"` and Letter-portrait `pdfOptions`
 * (printBackground on, zero margins — Letter matches the `@page` rules in
 * `globals.css`; A4 crops the lookbook pages). The exact shape is pinned by
 * `tests/browserless.test.ts` — changing it alters paid PDF output.
 * Side effects: none (pure).
 */
export function buildBrowserlessPdfBody(previewUrl: string): BrowserlessPdfBody {
  // "options" (not the legacy "pdfOptions"): Browserless v2's /pdf schema
  // rejects additional properties, and pdfOptions now 400s with
  // "must NOT have additional properties".
  return {
    url: previewUrl,
    gotoOptions: {
      waitUntil: "networkidle0",
    },
    options: {
      printBackground: true,
      format: "Letter",
      margin: {
        top: "0",
        right: "0",
        bottom: "0",
        left: "0",
      },
    },
  };
}

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 10_000;

function jitter(delayMs: number): number {
  return delayMs * (0.5 + Math.random() * 0.5);
}

function isTransientResponse(response: Response): boolean {
  return response.status === 429 ||
         response.status === 502 ||
         response.status === 503 ||
         response.status === 504;
}

function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    if (error instanceof TypeError && error.message.includes("fetch")) return true;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit & { signal?: AbortSignal }
): Promise<Response> {
  let lastError: unknown;
  let delayMs = RETRY_BASE_DELAY_MS;

  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const jitterDelay = jitter(delayMs);
      await sleep(jitterDelay);
      delayMs = Math.min(delayMs * 2, RETRY_MAX_DELAY_MS);
    }

    try {
      const response = await fetch(url, options);

      if (response.ok) {
        return response;
      }

      if (isTransientResponse(response)) {
        lastError = new Error(`Browserless transient error: ${response.status}`);
        response.body?.cancel();
        continue;
      }

      return response;
    } catch (error) {
      if (isTransientError(error)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("Browserless fetch failed after retries");
}

export async function fetchBrowserlessPdfWithCircuitBreaker(
  url: string,
  options: RequestInit & { signal?: AbortSignal }
): Promise<Response> {
  const cb = getCircuitBreaker("browserless", {
    failureThreshold: 3,
    cooldownMs: 30_000,
  });
  return cb.execute(() => fetchWithRetry(url, options));
}

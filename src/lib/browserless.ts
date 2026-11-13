export const BROWSERLESS_PDF_ENDPOINT = "https://chrome.browserless.io/pdf";

/**
 * Outbound render budget for the Browserless PDF call.
 *
 * Issue #1424 raised the budget from 60s → 90s after measurements showed
 * the chrome `networkidle` window trips for slow lookbook pages right at
 * the 60s ceiling. The unversioned `/api/export-pdf` route uses
 * `EXPORT_PDF_DEFAULT_TIMEOUT_MS` (90_000, `src/lib/export-pdf-service.ts`).
 * Issue #1536: the v1 `/api/v1/export-pdf` route still aborted at 60s, so
 * the same render could succeed on the unversioned path and be aborted on
 * the v1 path. It now uses this constant.
 *
 * Why the value is repeated instead of imported from
 * `@/lib/export-pdf-service`: the v1 route may not import that module —
 * the auth-seam regression suite (`tests/api-auth-route-regression.test.ts`)
 * pins the v1 route's seam set to the route file itself, and reaching the
 * service transitively adds the service's seams to it. The two constants
 * are pinned equal by `tests/api/v1-export-pdf-route.test.ts`, so they
 * cannot drift apart silently.
 */
export const BROWSERLESS_RENDER_TIMEOUT_MS = 90_000;

/**
 * Legacy 60s render budget.
 *
 * @deprecated Issue #1536 — the last consumer in `src/` (the v1
 * `/api/v1/export-pdf` route) now uses {@link BROWSERLESS_RENDER_TIMEOUT_MS}
 * (90s). The constant is kept only so the pinned value in
 * `tests/browserless.test.ts` still resolves; nothing in `src/` reads it.
 */
export const BROWSERLESS_TIMEOUT_MS = 60_000;

/**
 * Env var naming the hermetic e2e harness (see `tests/e2e/env.ts`).
 *
 * Purpose: a second, independent guard on the endpoint override below —
 * the override is inert unless this is explicitly set to "1", so a stray
 * `E2E_BROWSERLESS_PDF_URL` in a production `.env.local` cannot redirect
 * outbound PDF bytes. Deliberately NOT `NODE_ENV`-gated: the e2e suite
 * runs a production build (`next build && next start`), so NODE_ENV is
 * "production" in exactly the run that needs the override.
 */
export const E2E_HERMETIC_ENV_VAR = "E2E_HERMETIC";

/**
 * Env var overriding the Browserless endpoint inside the hermetic e2e
 * harness, so the real `src/app/api/export-pdf` route handler can be
 * exercised without ever contacting Browserless (issue #1084).
 *
 * Server-only: read via `process.env`, never `NEXT_PUBLIC_`, so it can
 * never reach a client bundle. Honored only when
 * {@link E2E_HERMETIC_ENV_VAR} is "1" — see
 * {@link resolveBrowserlessPdfUrl}. Both vars are set only by
 * `nextEnv()` in the e2e harness; `.env.example` documents them as
 * test-only.
 */
export const E2E_BROWSERLESS_PDF_URL_ENV_VAR = "E2E_BROWSERLESS_PDF_URL";

import { getCircuitBreaker } from "@/lib/circuit-breaker";

export interface BrowserlessPdfBody {
  url: string;
  gotoOptions: { waitUntil: "networkidle0"; timeout?: number };
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
  timeout?: number;
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
 * Resolves the Browserless endpoint to POST to, honoring the hermetic
 * e2e override.
 *
 * Contract: returns {@link E2E_BROWSERLESS_PDF_URL_ENV_VAR}'s value only
 * when {@link E2E_HERMETIC_ENV_VAR} is "1" AND the override is
 * non-blank; otherwise returns the real
 * {@link BROWSERLESS_PDF_ENDPOINT}. Both guards are required, so the
 * override is inert in production even if the URL var is set by
 * mistake. The endpoint override does not relax the credential
 * contract: the API key still rides in the `Authorization` header, never
 * the URL. Pinned by `tests/browserless.test.ts`.
 * Side effects: none (pure — raw env values are passed in by the caller,
 * matching `resolveDailyLimit`'s convention).
 */
export function resolveBrowserlessPdfUrl(
  hermetic: string | undefined,
  override: string | undefined
): string {
  if (hermetic?.trim() !== "1") return buildBrowserlessPdfUrl();
  if (override === undefined || override.trim() === "") return buildBrowserlessPdfUrl();
  return override.trim();
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
    timeout: 55000,
  };
}

export async function fetchBrowserlessPdfWithCircuitBreaker(
  url: string,
  options: RequestInit & { signal?: AbortSignal }
): Promise<Response> {
  const cb = getCircuitBreaker("browserless", {
    failureThreshold: 3,
    cooldownMs: 30_000,
  });
  return cb.execute(() => fetch(url, options));
}

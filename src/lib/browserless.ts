export const BROWSERLESS_PDF_ENDPOINT = "https://chrome.browserless.io/pdf";

export const BROWSERLESS_TIMEOUT_MS = 60_000;

export interface BrowserlessPdfBody {
  url: string;
  gotoOptions: { waitUntil: "networkidle0" };
  pdfOptions: {
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
  return {
    url: previewUrl,
    gotoOptions: {
      waitUntil: "networkidle0",
    },
    pdfOptions: {
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

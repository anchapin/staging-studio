import { describe, expect, it } from "vitest";

import {
  BROWSERLESS_TIMEOUT_MS,
  buildBrowserlessPdfBody,
  buildBrowserlessPdfUrl,
  resolveBrowserlessPdfUrl,
} from "@/lib/browserless";

describe("buildBrowserlessPdfUrl", () => {
  it("returns the exact Browserless PDF endpoint", () => {
    expect(buildBrowserlessPdfUrl()).toBe("https://chrome.browserless.io/pdf");
  });

  it("carries no query string — credentials never ride in the URL", () => {
    const url = new URL(buildBrowserlessPdfUrl());

    expect(url.search).toBe("");
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("chrome.browserless.io");
    expect(url.pathname).toBe("/pdf");
  });
});

describe("resolveBrowserlessPdfUrl", () => {
  const OVERRIDE = "http://127.0.0.1:39931/pdf";

  it("returns the real endpoint when no env vars are set (production path)", () => {
    expect(resolveBrowserlessPdfUrl(undefined, undefined)).toBe(
      "https://chrome.browserless.io/pdf"
    );
  });

  it("ignores the override unless the hermetic flag is exactly \"1\"", () => {
    // Issue #1084: the override is a test-only seam. A stray
    // E2E_BROWSERLESS_PDF_URL in a production .env.local must NOT be able
    // to redirect outbound PDF bytes, so any flag value other than "1"
    // keeps the real endpoint.
    for (const flag of [undefined, "", "  ", "0", "true", "yes", "2"]) {
      expect(resolveBrowserlessPdfUrl(flag, OVERRIDE)).toBe(
        "https://chrome.browserless.io/pdf"
      );
    }
  });

  it("honors the override when the hermetic flag is \"1\"", () => {
    expect(resolveBrowserlessPdfUrl("1", OVERRIDE)).toBe(OVERRIDE);
    expect(resolveBrowserlessPdfUrl("  1  ", OVERRIDE)).toBe(OVERRIDE);
  });

  it("keeps the real endpoint when the flag is set but the override is blank", () => {
    for (const blank of [undefined, "", "   "]) {
      expect(resolveBrowserlessPdfUrl("1", blank)).toBe(
        "https://chrome.browserless.io/pdf"
      );
    }
  });

  it("trims the override so a stray newline cannot corrupt the URL", () => {
    expect(resolveBrowserlessPdfUrl("1", `  ${OVERRIDE}\n`)).toBe(OVERRIDE);
  });
});

describe("buildBrowserlessPdfBody", () => {
  it("pins the exact request body shape for the paid PDF render", () => {
    const previewUrl =
      "https://stagingstudio.example.com/preview/cabc123?token=t";
    expect(buildBrowserlessPdfBody(previewUrl)).toEqual({
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
    });
  });

  it("uses Letter format with printBackground and zero margins", () => {
    const body = buildBrowserlessPdfBody("https://example.com/preview");

    expect(body.options.format).toBe("Letter");
    expect(body.options.printBackground).toBe(true);
    expect(Object.values(body.options.margin).every((m) => m === "0")).toBe(
      true
    );
  });
});

describe("BROWSERLESS_TIMEOUT_MS", () => {
  it("bounds the fetch at 60 seconds", () => {
    expect(BROWSERLESS_TIMEOUT_MS).toBe(60_000);
  });
});

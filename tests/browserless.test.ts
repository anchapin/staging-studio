import { describe, expect, it } from "vitest";

import {
  BROWSERLESS_TIMEOUT_MS,
  buildBrowserlessPdfBody,
  buildBrowserlessPdfUrl,
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

describe("buildBrowserlessPdfBody", () => {
  it("pins the exact request body shape for the paid PDF render", () => {
    expect(
      buildBrowserlessPdfBody(
        "https://stagingstudio.example.com/projects/cabc123/preview?token=t"
      )
    ).toEqual({
      url: "https://stagingstudio.example.com/projects/cabc123/preview?token=t",
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
    });
  });

  it("uses Letter format with printBackground and zero margins", () => {
    const body = buildBrowserlessPdfBody("https://example.com/preview");

    expect(body.pdfOptions.format).toBe("Letter");
    expect(body.pdfOptions.printBackground).toBe(true);
    expect(Object.values(body.pdfOptions.margin).every((m) => m === "0")).toBe(
      true
    );
  });
});

describe("BROWSERLESS_TIMEOUT_MS", () => {
  it("bounds the fetch at 60 seconds", () => {
    expect(BROWSERLESS_TIMEOUT_MS).toBe(60_000);
  });
});

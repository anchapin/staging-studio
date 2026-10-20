import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PREVIEW_CAPTURE_QUERY_PARAM,
  PREVIEW_CAPTURE_QUERY_VALUE,
} from "@/lib/preview-token";

/**
 * Pins the lookbook print-CSS contract (issue #1222).
 *
 * The export pipeline renders /preview/[id] through @page rules in
 * src/app/globals.css; a regression there is invisible to component
 * tests and only shows up as a bad PDF or a bad physical print. These
 * assertions read the source the same way tests/revalidate-preview.test.ts
 * pins route hygiene: the CSS contract is small and worth pinning exactly.
 */

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const previewPage = readFileSync(
  join(process.cwd(), "src/app/(print)/preview/[id]/page.tsx"),
  "utf8"
);
const exportRoute = readFileSync(
  join(process.cwd(), "src/app/api/export-pdf/route.ts"),
  "utf8"
);
const exportPdfService = readFileSync(
  join(process.cwd(), "src/lib/export-pdf-service.ts"),
  "utf8"
);

describe("lookbook print CSS (issue #1222)", () => {
  it("defines the --print-margin safe-area token with a 6mm default", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--print-margin:\s*6mm/);
  });

  it("keeps the Browserless capture path full-bleed via html.pdf-capture", () => {
    expect(css).toMatch(/\.pdf-capture\s*\{[^}]*--print-margin:\s*0mm/);
  });

  it("applies the token as the @page margin, not a bare 0", () => {
    expect(css).toMatch(/@page\s*\{[^}]*margin:\s*var\(--print-margin,\s*6mm\)/);
  });

  it("sizes .lookbook-page to the page content box, not 100vw", () => {
    const printBlock = css.slice(css.indexOf("@media print"));
    const rule = printBlock.match(/\.lookbook-page\s*\{[^}]*\}/);
    expect(rule).toBeTruthy();
    // The declaration itself (the comment above it mentions 100vw).
    expect(rule![0]).toMatch(/width:\s*100%;/);
    expect(rule![0]).not.toMatch(/width:\s*100vw/);
  });

  it("bumps small text and the footer on high-DPI physical output only", () => {
    const block = css.match(
      /@media print and \(min-resolution:\s*300dpi\)\s*\{[\s\S]*?\n\}/
    );
    expect(block).toBeTruthy();
    expect(block![0]).toContain("0.83rem"); // text-xs, ~+11%
    expect(block![0]).toContain("1rem"); // text-sm, ~+14%
    expect(block![0]).toContain("font-size: 7pt"); // footer margin box
  });

  it("marks the capture path: export route appends capture=pdf to the preview URL", () => {
    // Wave-5 revival (issue #1389): the URL build moved into
    // `lib/export-pdf-service.ts`; the route file re-exports the
    // constants so both the unversioned and the v1 routes share one
    // source of truth.
    expect(exportPdfService).toContain("${PREVIEW_CAPTURE_QUERY_PARAM}=${PREVIEW_CAPTURE_QUERY_VALUE}");
    expect(exportRoute).toContain("PREVIEW_CAPTURE_QUERY_PARAM");
    expect(exportRoute).toContain("PREVIEW_CAPTURE_QUERY_VALUE");
    expect(PREVIEW_CAPTURE_QUERY_PARAM).toBe("capture");
    expect(PREVIEW_CAPTURE_QUERY_VALUE).toBe("pdf");
  });

  it("the preview page turns the capture param into html.pdf-capture", () => {
    expect(previewPage).toContain('classList.add("pdf-capture")');
    expect(previewPage).toContain("PREVIEW_CAPTURE_QUERY_PARAM");
  });
});

/**
 * Export-PDF autosave-gate regression test (issue #1435).
 *
 * Pins the *contract* between the ExportPdfButton component and the
 * lookbook-editor's `onBeforeExport` gate, plus the exact toast copy
 * the brief calls for.
 *
 * Why this is string-source-pinned and not renderToStaticMarkup:
 *   - The button uses `useToast` + `useState`, both of which need a
 *     real React render tree. The repo convention is to avoid pulling
 *     in @testing-library (per `tests/edit-room-room-status-dot.test.tsx`
 *     style), so we instead pin the actual strings the button embeds.
 *   - Behavioral pinning (the click path) is covered by the e2e
 *     suite (`tests/e2e/specs/export-pdf.spec.ts`), which actually
 *     mounts the component in a real browser. Unit-pinning the gate
 *     shape guards against the smaller regression: rewriting the toast
 *     message back to the old "Save pending edits before exporting."
 *     one would un-silence a real failure mode.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..");

function readSource(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

describe("ExportPdfButton contract (issue #1435)", () => {
  it("embeds the brief's exact toast copy (the user-visible string)", () => {
    const source = readSource(
      "src/components/canvas/export-pdf-button.tsx",
    );

    // Brief copy: "We couldn't save your changes — Export-PDF is
    // paused until you retry." Captured in three substrings because
    // smart quotes / em-dash drift would otherwise quietly slide past
    // a string-equality check; substring guards survive the encoding
    // drift that other text has had in this repo.
    expect(source).toContain("We couldn't save your changes");
    expect(source).toContain("Export-PDF is paused until you retry.");
  });

  it("calls onBeforeExport and refuses to call /api/export-pdf when it resolves to false", () => {
    // Source-shape pin rather than behavioural: the button's onClick
    // handler MUST short-circuit on a falsy onBeforeExport result
    // BEFORE issuing the fetch to /api/export-pdf. The behavioural
    // version of this lives in tests/e2e/specs/export-pdf.spec.ts.
    const source = readSource(
      "src/components/canvas/export-pdf-button.tsx",
    );

    // Source-level ordering: the gate check (`onBeforeExport`) must
    // appear lexically before the `/api/export-pdf` fetch so a future
    // contributor who moves the fetch earlier (and accidentally
    // races a pending autosave) surfaces here.
    const onBeforeIndex = source.indexOf("onBeforeExport");
    const fetchIndex = source.indexOf("/api/export-pdf");
    const showErrorIndex = source.indexOf("showError");

    expect(onBeforeIndex, "ExportPdfButton must reference onBeforeExport").toBeGreaterThanOrEqual(0);
    expect(showErrorIndex, "ExportPdfButton must call showError on gate rejection").toBeGreaterThanOrEqual(0);
    expect(fetchIndex, "ExportPdfButton must issue a fetch to /api/export-pdf").toBeGreaterThanOrEqual(0);
    expect(onBeforeIndex < fetchIndex, "onBeforeExport must run BEFORE the /api/export-pdf fetch")
      .toBe(true);
  });

  it("lookbook-editor's flushBeforeExport refuses export when ANY controller reports status === error", () => {
    // The gate in lookbook-editor.tsx must short-circuit on status
    // checks, not just on flush() results. This is the half the
    // original wiring missed: a controller can be status=error with
    // nothing pending to flush, and a bare flush() check would let the
    // export through with stale data.
    const source = readSource(
      "src/app/(dashboard)/projects/[id]/lookbook/lookbook-editor.tsx",
    );

    expect(
      source.includes('status === "error"'),
      "lookbook-editor.tsx must inspect controller status === 'error'",
    ).toBe(true);
  });
});

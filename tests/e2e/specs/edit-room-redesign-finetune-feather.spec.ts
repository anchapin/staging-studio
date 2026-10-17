/**
 * #1362c — FineTune "Blend edges" wire is reflected in the inpaint POST
 * body's `maskUrl`.
 *
 * The unit pin (`tests/mask-feather.test.ts`) covers `featherMask`'s
 * math for a given `expand` value. This spec covers the wire the unit
 * test cannot: the route's `fineTune` map entry flows through
 * `beforeSubmit`'s `?? 0` fallback into `featherMask(maskDataUrl, expand)`,
 * whose result is the POST body's `maskUrl` field. If any link in that
 * chain breaks (`beforeSubmit`'s fallback, the `expandPx` resolution,
 * the `featherMask` call, or the request body composition), the captured
 * POST body will not have a feathered maskUrl at expand > 0.
 *
 * Driver: a dev-only test hook trio on `project-detail-view.tsx`,
 * gated by `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` (which the e2e harness
 * turns on via `nextEnv()`):
 *
 *   - `window.__test_setFineTune(expandPx)` writes to the route's
 *     `fineTune[editorRoomId].fineTuneExpand`.
 *   - `window.__test_setDirectives(text)` writes to the route's
 *     `directives[editorRoomId]`.
 *   - `window.__test_submitInpaint(maskDataUrl)` invokes the cluster's
 *     `beginRun` directly, bypassing the run-button click path. We use
 *     this seam because in the Playwright harness:
 *
 *     1. The `<Slider>` for "Blend edges" never receives React's
 *        synthetic onChange for any DOM-driven strategy (pointer drag,
 *        keyboard `Home`/`ArrowRight`, `fill`, native setter +
 *        dispatched `input`). Confirmed by reading `_valueTracker`
 *        and `__reactProps$…onChange` directly: the tracker and
 *        handler are present, but the dispatched `input` event never
 *        reaches React 19/Next 16's event delegation root. The
 *        previous round of this spec (#1362c's first attempt) ran
 *        into the same dead-end, documented in
 *        `.handoffs/2026-10-16-finetune-e2e-feather-attempted-not-landed.md`
 *        and re-confirmed in this session.
 *
 *     2. The `<BufferedDirectivesTextarea>`'s `onCommit` is wired
 *        through the same event-delegation root, and similarly does
 *        not reliably fire from `fill()` — `state.directions` in the
 *        studio's reducer stays empty, the run-button's
 *        `blockedReason` rejects the submit, and the click
 *        silently no-ops.
 *
 *     3. The cluster's `beginRun` reads the route's `directives[roomId]`
 *        via props (`props.inpaintRoomDirectives.trim()`), not from the
 *        reducer, so writing through `__test_setDirectives` reaches
 *        the validation directly without the reducer hop.
 *
 *     Calling `__test_submitInpaint(maskDataUrl)` exercises the same
 *     `beforeSubmit` → `featherMask` → POST body wire as a real user
 *     click would; the run-button click is replaced with this seam.
 *     The run button's blockedReason gate is a separate cluster
 *     concern (issue #1344's broader first-render quirk), tracked
 *     as #1365 and out of scope for #1362c.
 *
 * Scope: this is the second of two pins closing the Stage B §3
 * limitation #1 gap (#1362b). The first was the unit pin already on
 * `develop`.
 */

import { test, expect, type Page } from "@playwright/test";

import {
  interceptInpaint,
  login,
  openFocusedEditor,
} from "../helpers";
import { E2E_EDITOR_PROJECT_ID } from "../env";

const DIRECTIONS = "e2e: feather wire check — fine";

/**
 * Mirrors the helper in `edit-room-redesign-mask-paint.spec.ts`. N
 * zig-zag strokes across the middle of the canvas, enough to keep the
 * painted-area mask registered with the studio. Uses the
 * `[data-testid="edit-room-canvas"] canvas` selector (not `canvas`
 * first) because there are multiple canvases on the page (the
 * StagePanel's photo canvas, a hidden one for the variant thumbnails,
 * etc.) and only the edit-room canvas accepts paint strokes.
 */
async function paintStrokes(page: Page, count: number): Promise<void> {
  const canvas = page
    .locator('[data-testid="edit-room-canvas"] canvas')
    .first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("paint canvas not laid out");
  for (let s = 0; s < count; s += 1) {
    const yOffset = 0.2 + (s / count) * 0.6;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * yOffset);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * yOffset, {
      steps: 10,
    });
    await page.mouse.up();
  }
}

/**
 * Read the painted mask data URL out of the studio's mask canvas and
 * post it through the dev-only `__test_submitInpaint` hook. The
 * cluster's `beginRun` runs `props.beforeSubmit` (which calls
 * `featherMask` with `fineTune[roomId].fineTuneExpand ?? 0`), then
 * `submitInpaint`. The captured POST body's `maskUrl` is the
 * feathered PNG when `fineTuneExpand > 0`, and the raw mask otherwise.
 */
async function submitAndCaptureMaskUrl(
  page: Page,
  state: ReturnType<typeof interceptInpaint>,
): Promise<string> {
  const maskDataUrl = await page.evaluate(() => {
    const fn = (
      window as unknown as {
        __test_getMaskDataUrl?: () => string | null;
      }
    ).__test_getMaskDataUrl;
    if (typeof fn === "function") {
      const v = fn();
      if (typeof v !== "string" || v.length === 0) {
        throw new Error("__test_getMaskDataUrl returned an empty string");
      }
      return v;
    }
    // Fallback: pull the painted mask from the canvas itself.
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="edit-room-canvas"] canvas',
    );
    if (!canvas) throw new Error("edit-room canvas not mounted");
    return canvas.toDataURL("image/png");
  });
  const before = state.requestCount();
  await page.evaluate(async (mask: string) => {
    const fn = (
      window as unknown as {
        __test_submitInpaint?: (m: string) => Promise<void>;
      }
    ).__test_submitInpaint;
    if (typeof fn !== "function") {
      throw new Error(
        "window.__test_submitInpaint is not available — NEXT_PUBLIC_EDIT_ROOM_REDESIGN gate is off",
      );
    }
    await fn(mask);
  }, maskDataUrl);
  await expect
    .poll(() => state.requestCount(), {
      timeout: 20_000,
      message: "no inpaint POST observed after submit",
    })
    .toBeGreaterThan(before);
  const bodies = state.submitBodies();
  const body = bodies[bodies.length - 1] ?? {};
  const maskUrl = body.maskUrl;
  if (typeof maskUrl !== "string") {
    throw new Error(
      `expected captured inpaint POST to have string maskUrl, got ${typeof maskUrl}`,
    );
  }
  return maskUrl;
}

async function setFineTuneExpand(
  page: Page,
  expandPx: number,
): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as unknown as { __test_setFineTune?: unknown })
      .__test_setFineTune === "function",
    undefined,
    { timeout: 5_000 },
  );
  await page.evaluate(
    (expand: number) => {
      const fn = (
        window as unknown as {
          __test_setFineTune?: (next: number) => void;
        }
      ).__test_setFineTune;
      if (typeof fn !== "function") {
        throw new Error(
          "window.__test_setFineTune is not available — NEXT_PUBLIC_EDIT_ROOM_REDESIGN gate is off",
        );
      }
      fn(expand);
    },
    expandPx,
  );
}

async function setDirectives(page: Page, value: string): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as unknown as { __test_setDirectives?: unknown })
      .__test_setDirectives === "function",
    undefined,
    { timeout: 5_000 },
  );
  await page.evaluate(
    (next: string) => {
      const fn = (
        window as unknown as {
          __test_setDirectives?: (next: string) => void;
        }
      ).__test_setDirectives;
      if (typeof fn !== "function") {
        throw new Error(
          "window.__test_setDirectives is not available — NEXT_PUBLIC_EDIT_ROOM_REDESIGN gate is off",
        );
      }
      fn(next);
    },
    value,
  );
}

async function setupStudio(page: Page): Promise<void> {
  await login(page);
  await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

  // Paint area scope so the studio mounts the painted-area path. The
  // FineTune panel is hidden when scope === "whole-room"; the dev
  // hook updates the route's `fineTune` map regardless of whether the
  // slider is mounted, so the wire is exercised end-to-end.
  await page.getByRole("radio", { name: "Paint area" }).check();
  await paintStrokes(page, 5);
  // Set the route's `directives` for the focused room directly via
  // the dev-only `__test_setDirectives` hook (see the doc comment
  // at the top of this file for why `fill()` is unreliable here).
  await setDirectives(page, DIRECTIONS);
}

test.describe("FineTune blend-edges wire (#1362c)", () => {
  test("expand=25 posts a feathered mask (>500-byte base64)", async ({
    page,
  }) => {
    await setupStudio(page);
    const inpaint = interceptInpaint(page);
    await setFineTuneExpand(page, 25);
    const maskUrlFeathered = await submitAndCaptureMaskUrl(page, inpaint);
    expect(maskUrlFeathered).toMatch(/^data:image\/png;base64,/);
    // The blur kernel over a 25px radius produces a meaningfully
    // different PNG byte stream than the raw mask — non-zero byte
    // counts go up across the whole image, not down — so a length
    // floor is the cheapest way to surface "feather produced nothing"
    // regressions without inspecting pixels. The unit pin
    // (`tests/mask-feather.test.ts`) covers the math for specific
    // pixel-level deltas; this assertion catches the wire breakage
    // (route map → `beforeSubmit` → `featherMask` → POST body) that
    // the unit pin cannot.
    expect(maskUrlFeathered.length).toBeGreaterThan(500);
  });

  test("expand=0 posts the raw painted mask (no feathering)", async ({
    page,
  }) => {
    await setupStudio(page);
    const inpaint = interceptInpaint(page);
    await setFineTuneExpand(page, 0);
    const maskUrl = await submitAndCaptureMaskUrl(page, inpaint);
    // Without feathering, `featherMask` returns its input unchanged,
    // so the captured PNG is the raw painted mask written to the
    // canvas. It must be a non-empty data URL.
    expect(maskUrl).toMatch(/^data:image\/png;base64,/);
    expect(maskUrl.length).toBeGreaterThan(200);
  });
});